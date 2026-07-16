# PixelFlow — Serverless Image Resizer

PixelFlow is an AWS serverless application that automatically resizes
and optimizes uploaded images.

## Planned AWS Services

- Amazon S3
- AWS Lambda
- Amazon API Gateway
- Amazon DynamoDB
- Amazon CloudFront
- AWS IAM

## Status

Project development in progress.

<!-- SCREENSHOTS_START -->

---

## Application Screenshots

<p align="center">
  <strong>PixelFlow — AWS Serverless Image Resizer</strong>
</p>

<p align="center">
  Upload, resize, convert and optimize images through an event-driven AWS pipeline.
</p>

### Application Interface

<table>
  <tr>
    <td width="50%" align="center">
      <strong>PixelFlow Home Page</strong>
      <br><br>
      <img
        src="screenshots/01-pixelflow-home.png"
        alt="PixelFlow home page"
        width="100%">
    </td>
    <td width="50%" align="center">
      <strong>Image Selection and Preview</strong>
      <br><br>
      <img
        src="screenshots/02-image-upload.png"
        alt="PixelFlow image upload and preview"
        width="100%">
    </td>
  </tr>

  <tr>
    <td width="50%" align="center">
      <strong>Resize and Output Settings</strong>
      <br><br>
      <img
        src="screenshots/03-resize-settings.png"
        alt="PixelFlow resize dimensions and quality settings"
        width="100%">
    </td>
    <td width="50%" align="center">
      <strong>Optimized Processing Result</strong>
      <br><br>
      <img
        src="screenshots/04-processing-result.png"
        alt="PixelFlow original and optimized image comparison"
        width="100%">
    </td>
  </tr>
</table>

### Processing History and AWS Deployment

<table>
  <tr>
    <td width="50%" align="center">
      <strong>Recent Processing Jobs</strong>
      <br><br>
      <img
        src="screenshots/05-job-history.png"
        alt="PixelFlow image-processing job history"
        width="100%">
    </td>
    <td width="50%" align="center">
      <strong>AWS Lambda Image Processor</strong>
      <br><br>
      <img
        src="screenshots/06-aws-lambda-processor.png"
        alt="PixelFlow AWS Lambda image processor active"
        width="100%">
    </td>
  </tr>
</table>

<p align="center">
  <em>
    Images are uploaded using presigned S3 forms, processed by a
    container-based AWS Lambda function using Pillow, and tracked in DynamoDB.
  </em>
</p>

<!-- SCREENSHOTS_END -->
