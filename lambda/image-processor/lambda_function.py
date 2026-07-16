import io
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath
from urllib.parse import unquote_plus

import boto3
from PIL import Image, ImageOps

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]
TABLE_NAME = os.environ["TABLE_NAME"]

table = dynamodb.Table(TABLE_NAME)

CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def bounded_integer(value, default, minimum, maximum):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default

    return max(minimum, min(number, maximum))


def identify_job_id(object_key, metadata):
    metadata_job_id = metadata.get("job-id")

    if metadata_job_id:
        return metadata_job_id

    parts = object_key.split("/")

    if len(parts) >= 3 and parts[0] == "uploads":
        return parts[1]

    return str(uuid.uuid5(uuid.NAMESPACE_URL, object_key))


def normalize_format(value):
    output_format = (value or "webp").strip().upper()

    if output_format == "JPG":
        output_format = "JPEG"

    if output_format not in CONTENT_TYPES:
        output_format = "WEBP"

    return output_format


def prepare_image(image, output_format):
    image = ImageOps.exif_transpose(image)

    if output_format == "JPEG":
        if image.mode in ("RGBA", "LA"):
            background = Image.new("RGB", image.size, "white")
            alpha = image.getchannel("A")
            background.paste(image.convert("RGB"), mask=alpha)
            return background

        return image.convert("RGB")

    if output_format in ("PNG", "WEBP"):
        if image.mode not in ("RGB", "RGBA"):
            return image.convert("RGBA")

    return image


def save_image(image, output_format, quality):
    output = io.BytesIO()

    if output_format == "JPEG":
        image.save(
            output,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )

    elif output_format == "WEBP":
        image.save(
            output,
            format="WEBP",
            quality=quality,
            method=6,
        )

    else:
        image.save(
            output,
            format="PNG",
            optimize=True,
        )

    output.seek(0)
    return output


def process_record(record):
    source_bucket = record["s3"]["bucket"]["name"]
    source_key = unquote_plus(record["s3"]["object"]["key"])

    logger.info(
        "Processing s3://%s/%s",
        source_bucket,
        source_key,
    )

    head = s3.head_object(
        Bucket=source_bucket,
        Key=source_key,
    )

    metadata = head.get("Metadata", {})

    job_id = identify_job_id(source_key, metadata)

    target_width = bounded_integer(
        metadata.get("target-width"),
        800,
        50,
        4000,
    )

    target_height = bounded_integer(
        metadata.get("target-height"),
        800,
        50,
        4000,
    )

    quality = bounded_integer(
        metadata.get("quality"),
        82,
        30,
        95,
    )

    output_format = normalize_format(
        metadata.get("output-format")
    )

    try:
        table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET #status = :status, "
                "source_bucket = :source_bucket, "
                "source_key = :source_key, "
                "processing_started_at = :started"
            ),
            ExpressionAttributeNames={
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":status": "PROCESSING",
                ":source_bucket": source_bucket,
                ":source_key": source_key,
                ":started": utc_now(),
            },
        )

        source_response = s3.get_object(
            Bucket=source_bucket,
            Key=source_key,
        )

        source_bytes = source_response["Body"].read()
        original_size = len(source_bytes)

        with Image.open(io.BytesIO(source_bytes)) as image:
            original_width, original_height = image.size

            image = prepare_image(
                image,
                output_format,
            )

            image.thumbnail(
                (target_width, target_height),
                Image.Resampling.LANCZOS,
            )

            output_width, output_height = image.size

            resized_file = save_image(
                image,
                output_format,
                quality,
            )

            resized_bytes = resized_file.getvalue()

        extension = {
            "JPEG": "jpg",
            "PNG": "png",
            "WEBP": "webp",
        }[output_format]

        source_name = PurePosixPath(source_key).stem
        safe_name = "".join(
            character
            if character.isalnum() or character in ("-", "_")
            else "-"
            for character in source_name
        ).strip("-")

        if not safe_name:
            safe_name = "image"

        output_key = (
            f"resized/{job_id}/"
            f"{safe_name}-{output_width}x{output_height}.{extension}"
        )

        s3.put_object(
            Bucket=OUTPUT_BUCKET,
            Key=output_key,
            Body=resized_bytes,
            ContentType=CONTENT_TYPES[output_format],
            ServerSideEncryption="AES256",
            Metadata={
                "job-id": job_id,
                "source-key": source_key,
            },
        )

        table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET #status = :status, "
                "output_bucket = :output_bucket, "
                "output_key = :output_key, "
                "output_format = :output_format, "
                "original_width = :original_width, "
                "original_height = :original_height, "
                "output_width = :output_width, "
                "output_height = :output_height, "
                "original_size = :original_size, "
                "output_size = :output_size, "
                "completed_at = :completed_at "
                "REMOVE error_message"
            ),
            ExpressionAttributeNames={
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":status": "COMPLETED",
                ":output_bucket": OUTPUT_BUCKET,
                ":output_key": output_key,
                ":output_format": output_format,
                ":original_width": original_width,
                ":original_height": original_height,
                ":output_width": output_width,
                ":output_height": output_height,
                ":original_size": original_size,
                ":output_size": len(resized_bytes),
                ":completed_at": utc_now(),
            },
        )

        logger.info(
            "Completed job %s: %s",
            job_id,
            output_key,
        )

        return {
            "job_id": job_id,
            "status": "COMPLETED",
            "output_key": output_key,
        }

    except Exception as error:
        logger.exception(
            "Image-processing job failed: %s",
            job_id,
        )

        table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET #status = :status, "
                "error_message = :error, "
                "failed_at = :failed_at"
            ),
            ExpressionAttributeNames={
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":status": "FAILED",
                ":error": str(error)[:500],
                ":failed_at": utc_now(),
            },
        )

        raise


def lambda_handler(event, context):
    records = event.get("Records", [])

    results = [
        process_record(record)
        for record in records
        if record.get("eventSource") == "aws:s3"
    ]

    return {
        "processed": len(results),
        "results": results,
    }