import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.config import Config

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    endpoint_url=f"https://s3.{AWS_REGION}.amazonaws.com",
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "virtual"},
    ),
)
dynamodb = boto3.resource("dynamodb")

UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]
TABLE_NAME = os.environ["TABLE_NAME"]

table = dynamodb.Table(TABLE_NAME)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def json_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)

        return float(value)

    raise TypeError(f"Unsupported value: {type(value)}")


def api_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(
            body,
            default=json_default,
        ),
    }


def parse_body(event):
    raw_body = event.get("body") or "{}"

    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError:
        return {}


def bounded_integer(value, default, minimum, maximum):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default

    return max(minimum, min(number, maximum))


def safe_filename(filename, content_type):
    basename = os.path.basename(
        str(filename or "image")
    )

    stem = os.path.splitext(basename)[0]

    stem = re.sub(
        r"[^A-Za-z0-9_-]+",
        "-",
        stem,
    ).strip("-")

    if not stem:
        stem = "image"

    return stem[:80] + ALLOWED_CONTENT_TYPES[content_type]


def create_job(body):
    filename = str(
        body.get("filename") or ""
    ).strip()

    content_type = str(
        body.get("contentType") or ""
    ).strip().lower()

    if not filename:
        return api_response(
            400,
            {"message": "filename is required"},
        )

    if content_type not in ALLOWED_CONTENT_TYPES:
        return api_response(
            400,
            {
                "message": (
                    "Only JPEG, PNG and WebP images are supported."
                )
            },
        )

    width = bounded_integer(
        body.get("width"),
        800,
        50,
        4000,
    )

    height = bounded_integer(
        body.get("height"),
        800,
        50,
        4000,
    )

    quality = bounded_integer(
        body.get("quality"),
        82,
        30,
        95,
    )

    output_format = str(
        body.get("outputFormat") or "webp"
    ).strip().lower()

    if output_format not in {
        "jpg",
        "jpeg",
        "png",
        "webp",
    }:
        output_format = "webp"

    if output_format == "jpg":
        output_format = "jpeg"

    job_id = str(uuid.uuid4())

    clean_filename = safe_filename(
        filename,
        content_type,
    )

    object_key = (
        f"uploads/{job_id}/{clean_filename}"
    )

    created_at = utc_now()

    item = {
        "job_id": job_id,
        "status": "QUEUED",
        "original_filename": clean_filename,
        "source_key": object_key,
        "content_type": content_type,
        "target_width": width,
        "target_height": height,
        "quality": quality,
        "output_format": output_format.upper(),
        "created_at": created_at,
    }

    table.put_item(Item=item)

    fields = {
        "Content-Type": content_type,
        "x-amz-server-side-encryption": "AES256",
        "x-amz-meta-job-id": job_id,
        "x-amz-meta-target-width": str(width),
        "x-amz-meta-target-height": str(height),
        "x-amz-meta-quality": str(quality),
        "x-amz-meta-output-format": output_format,
    }

    conditions = [
        {"Content-Type": content_type},
        {
            "x-amz-server-side-encryption":
                "AES256"
        },
        {
            "x-amz-meta-job-id":
                job_id
        },
        {
            "x-amz-meta-target-width":
                str(width)
        },
        {
            "x-amz-meta-target-height":
                str(height)
        },
        {
            "x-amz-meta-quality":
                str(quality)
        },
        {
            "x-amz-meta-output-format":
                output_format
        },
        [
            "content-length-range",
            1,
            MAX_UPLOAD_BYTES,
        ],
    ]

    upload = s3.generate_presigned_post(
        Bucket=UPLOAD_BUCKET,
        Key=object_key,
        Fields=fields,
        Conditions=conditions,
        ExpiresIn=900,
    )

    return api_response(
        201,
        {
            "jobId": job_id,
            "status": "QUEUED",
            "upload": upload,
            "expiresIn": 900,
            "maxFileSize": MAX_UPLOAD_BYTES,
        },
    )


def add_result_urls(item):
    if (
        item.get("status") == "COMPLETED"
        and item.get("output_key")
    ):
        output_key = item["output_key"]

        item["preview_url"] = (
            s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": OUTPUT_BUCKET,
                    "Key": output_key,
                },
                ExpiresIn=900,
            )
        )

        download_name = os.path.basename(
            output_key
        )

        item["download_url"] = (
            s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": OUTPUT_BUCKET,
                    "Key": output_key,
                    "ResponseContentDisposition": (
                        f'attachment; '
                        f'filename="{download_name}"'
                    ),
                },
                ExpiresIn=900,
            )
        )

    return item


def get_job(job_id):
    result = table.get_item(
        Key={"job_id": job_id},
        ConsistentRead=True,
    )

    item = result.get("Item")

    if not item:
        return api_response(
            404,
            {"message": "Job not found"},
        )

    return api_response(
        200,
        add_result_urls(item),
    )


def list_jobs():
    result = table.scan(
        Limit=50,
    )

    items = result.get("Items", [])

    items.sort(
        key=lambda item: item.get(
            "created_at",
            "",
        ),
        reverse=True,
    )

    items = [
        add_result_urls(item)
        for item in items[:20]
    ]

    return api_response(
        200,
        {
            "jobs": items,
            "count": len(items),
        },
    )


def lambda_handler(event, context):
    request_context = event.get(
        "requestContext",
        {},
    )

    http_context = request_context.get(
        "http",
        {},
    )

    method = http_context.get(
        "method",
        "GET",
    ).upper()

    path = event.get("rawPath") or "/"

    if method == "OPTIONS":
        return {
            "statusCode": 204,
            "body": "",
        }

    if method == "GET" and path == "/health":
        return api_response(
            200,
            {
                "status": "healthy",
                "service": "pixelflow-api",
            },
        )

    if method == "POST" and path == "/jobs":
        return create_job(
            parse_body(event)
        )

    if method == "GET" and path == "/jobs":
        return list_jobs()

    if (
        method == "GET"
        and path.startswith("/jobs/")
    ):
        job_id = path.split("/")[-1]

        return get_job(job_id)

    return api_response(
        404,
        {"message": "Route not found"},
    )