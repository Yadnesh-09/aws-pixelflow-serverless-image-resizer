"use strict";

const API_BASE_URL =
  window.PIXELFLOW_CONFIG.apiUrl.replace(/\/+$/, "");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const HISTORY_KEY = "pixelflow-job-history";

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const browseButton = document.getElementById("browseButton");
const selectedFilePanel = document.getElementById("selectedFile");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileDetails = document.getElementById("selectedFileDetails");
const originalPreview = document.getElementById("originalPreview");
const removeFileButton = document.getElementById("removeFileButton");

const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const formatInput = document.getElementById("formatInput");
const qualityInput = document.getElementById("qualityInput");
const qualityValue = document.getElementById("qualityValue");
const presetButtons = [
  ...document.querySelectorAll(".preset-button")
];

const processButton = document.getElementById("processButton");
const processButtonText = document.getElementById("processButtonText");
const progressArea = document.getElementById("progressArea");
const progressTitle = document.getElementById("progressTitle");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const progressMessage = document.getElementById("progressMessage");
const message = document.getElementById("message");
const apiStatus = document.getElementById("apiStatus");

const resultSection = document.getElementById("resultSection");
const resultOriginalPreview =
  document.getElementById("resultOriginalPreview");
const optimizedPreview =
  document.getElementById("optimizedPreview");
const originalDimensions =
  document.getElementById("originalDimensions");
const outputDimensions =
  document.getElementById("outputDimensions");
const originalSizeResult =
  document.getElementById("originalSizeResult");
const outputSizeResult =
  document.getElementById("outputSizeResult");
const reductionValue =
  document.getElementById("reductionValue");
const savedBytes = document.getElementById("savedBytes");
const downloadButton =
  document.getElementById("downloadButton");
const resizeAnotherButton =
  document.getElementById("resizeAnotherButton");

const historyGrid = document.getElementById("historyGrid");
const emptyHistory = document.getElementById("emptyHistory");

let selectedFile = null;
let selectedFileUrl = "";
let selectedImageWidth = 0;
let selectedImageHeight = 0;
let processing = false;

function formatBytes(bytes) {
  const number = Number(bytes || 0);

  if (!number) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(number) / Math.log(1024)),
    units.length - 1
  );

  const value = number / Math.pow(1024, unitIndex);

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, number));
}

function setMessage(text, type = "error") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function clearMessage() {
  message.textContent = "";
  message.className = "message hidden";
}

function setProgress(percent, title, detail) {
  const safePercent = Math.max(0, Math.min(100, percent));

  progressArea.classList.remove("hidden");
  progressBar.style.width = `${safePercent}%`;
  progressPercent.textContent = `${safePercent}%`;
  progressTitle.textContent = title;
  progressMessage.textContent = detail;
}

function resetProgress() {
  progressArea.classList.add("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
}

function setProcessing(value) {
  processing = value;

  processButton.disabled = value || !selectedFile;

  if (value) {
    processButtonText.textContent = "Processing image…";
  } else if (selectedFile) {
    processButtonText.textContent = "Resize and optimize image";
  } else {
    processButtonText.textContent = "Select an image first";
  }
}

function isSupportedFile(file) {
  return [
    "image/jpeg",
    "image/png",
    "image/webp"
  ].includes(file.type);
}

function removeSelectedFile() {
  if (selectedFileUrl) {
    URL.revokeObjectURL(selectedFileUrl);
  }

  selectedFile = null;
  selectedFileUrl = "";
  selectedImageWidth = 0;
  selectedImageHeight = 0;

  fileInput.value = "";
  originalPreview.removeAttribute("src");

  selectedFilePanel.classList.add("hidden");
  dropZone.classList.remove("hidden");

  resultSection.classList.add("hidden");

  clearMessage();
  resetProgress();
  setProcessing(false);
}

function loadImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    };

    image.onerror = reject;
    image.src = url;
  });
}

async function selectFile(file) {
  clearMessage();

  if (!file) {
    return;
  }

  if (!isSupportedFile(file)) {
    setMessage(
      "Only JPEG, PNG and WebP images are supported."
    );
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    setMessage(
      "The selected image exceeds the 10 MB upload limit."
    );
    return;
  }

  if (selectedFileUrl) {
    URL.revokeObjectURL(selectedFileUrl);
  }

  selectedFile = file;
  selectedFileUrl = URL.createObjectURL(file);

  try {
    const dimensions =
      await loadImageDimensions(selectedFileUrl);

    selectedImageWidth = dimensions.width;
    selectedImageHeight = dimensions.height;
  } catch {
    selectedImageWidth = 0;
    selectedImageHeight = 0;
  }

  originalPreview.src = selectedFileUrl;
  selectedFileName.textContent = file.name;

  selectedFileDetails.textContent =
    `${formatBytes(file.size)} • ` +
    `${selectedImageWidth || "?"} × ${selectedImageHeight || "?"}`;

  dropZone.classList.add("hidden");
  selectedFilePanel.classList.remove("hidden");

  setProcessing(false);
}

function getSavedJobIds() {
  try {
    const value =
      JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");

    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveJobId(jobId) {
  const current = getSavedJobIds();

  const updated = [
    jobId,
    ...current.filter(id => id !== jobId)
  ].slice(0, 12);

  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(updated)
  );
}

async function fetchJob(jobId) {
  const response = await fetch(
    `${API_BASE_URL}/jobs/${encodeURIComponent(jobId)}`,
    {
      cache: "no-store"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Could not retrieve the image job."
    );
  }

  return data;
}

async function createJob() {
  const width = clampNumber(
    widthInput.value,
    50,
    4000,
    800
  );

  const height = clampNumber(
    heightInput.value,
    50,
    4000,
    800
  );

  const quality = clampNumber(
    qualityInput.value,
    30,
    95,
    82
  );

  widthInput.value = String(width);
  heightInput.value = String(height);

  const response = await fetch(
    `${API_BASE_URL}/jobs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filename: selectedFile.name,
        contentType: selectedFile.type,
        width,
        height,
        quality,
        outputFormat: formatInput.value
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Could not create the processing job."
    );
  }

  return data;
}

async function uploadToS3(upload) {
  const formData = new FormData();

  Object.entries(upload.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });

  formData.append("file", selectedFile);

  const response = await fetch(upload.url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `S3 upload failed (${response.status}). ${detail}`
    );
  }
}

async function waitForCompletion(jobId) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    await new Promise(resolve => {
      window.setTimeout(resolve, 1800);
    });

    const job = await fetchJob(jobId);

    const progress = Math.min(
      95,
      55 + Math.round((attempt / 40) * 40)
    );

    setProgress(
      progress,
      "Optimizing image…",
      `AWS Lambda status: ${job.status}`
    );

    if (job.status === "COMPLETED") {
      return job;
    }

    if (job.status === "FAILED") {
      throw new Error(
        job.error_message || "Image processing failed."
      );
    }
  }

  throw new Error(
    "Processing is taking longer than expected. Check the history shortly."
  );
}

function displayResult(job) {
  const originalSize = Number(job.original_size || selectedFile.size);
  const outputSize = Number(job.output_size || 0);

  const reduction =
    originalSize > 0
      ? Math.max(
          0,
          Math.round(
            ((originalSize - outputSize) / originalSize) * 100
          )
        )
      : 0;

  resultOriginalPreview.src = selectedFileUrl;
  optimizedPreview.src = job.preview_url;

  originalDimensions.textContent =
    `${job.original_width || selectedImageWidth} × ` +
    `${job.original_height || selectedImageHeight}`;

  outputDimensions.textContent =
    `${job.output_width} × ${job.output_height}`;

  originalSizeResult.textContent =
    formatBytes(originalSize);

  outputSizeResult.textContent =
    formatBytes(outputSize);

  reductionValue.textContent = `${reduction}%`;

  savedBytes.textContent =
    `${formatBytes(Math.max(0, originalSize - outputSize))} saved`;

  downloadButton.href = job.download_url;
  downloadButton.setAttribute(
    "download",
    job.original_filename || "pixelflow-result"
  );

  resultSection.classList.remove("hidden");

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function processSelectedImage() {
  if (!selectedFile || processing) {
    return;
  }

  clearMessage();
  resultSection.classList.add("hidden");
  setProcessing(true);

  try {
    setProgress(
      12,
      "Creating secure upload…",
      "Requesting a temporary S3 upload form."
    );

    const createdJob = await createJob();

    saveJobId(createdJob.jobId);

    setProgress(
      32,
      "Uploading image…",
      "Securely uploading the original image to Amazon S3."
    );

    await uploadToS3(createdJob.upload);

    setProgress(
      55,
      "Upload completed",
      "Waiting for the S3 event to start AWS Lambda."
    );

    const completedJob =
      await waitForCompletion(createdJob.jobId);

    setProgress(
      100,
      "Optimization completed",
      "Your resized image is ready."
    );

    displayResult(completedJob);
    setMessage(
      "Image resized and optimized successfully.",
      "success"
    );

    await renderHistory();
  } catch (error) {
    setMessage(
      error.message || "An unexpected error occurred."
    );
  } finally {
    setProcessing(false);
  }
}

async function checkApiHealth() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/health`,
      {
        cache: "no-store"
      }
    );

    const data = await response.json();

    if (!response.ok || data.status !== "healthy") {
      throw new Error("API unavailable");
    }

    apiStatus.textContent = "API online";
    apiStatus.className = "api-status online";
  } catch {
    apiStatus.textContent = "API offline";
    apiStatus.className = "api-status offline";
  }
}

function createHistoryCard(job) {
  const article = document.createElement("article");
  article.className = "history-card";

  const statusClass =
    String(job.status || "").toLowerCase();

  const imageHtml =
    job.preview_url
      ? `<img src="${job.preview_url}" alt="Resized image">`
      : "";

  const outputDetails =
    job.output_width && job.output_height
      ? `${job.output_width} × ${job.output_height}`
      : `${job.target_width || "?"} × ${job.target_height || "?"}`;

  const date = job.created_at
    ? new Date(job.created_at).toLocaleString()
    : "Recent job";

  const downloadHtml =
    job.download_url
      ? `
        <a
          class="history-download"
          href="${job.download_url}"
        >
          Download image ↗
        </a>
      `
      : "";

  article.innerHTML = `
    <div class="history-image">
      ${imageHtml}
    </div>

    <div class="history-body">
      <div class="history-top">
        <small>${date}</small>

        <span class="history-status ${statusClass}">
          ${job.status || "UNKNOWN"}
        </span>
      </div>

      <h3>${job.original_filename || "Image job"}</h3>

      <p>${outputDetails} • ${job.output_format || "IMAGE"}</p>

      <div class="history-meta">
        <span>${formatBytes(job.original_size)}</span>
        <span>→</span>
        <span>${formatBytes(job.output_size)}</span>
      </div>

      ${downloadHtml}
    </div>
  `;

  return article;
}

async function renderHistory() {
  const jobIds = getSavedJobIds();

  historyGrid.replaceChildren();

  if (!jobIds.length) {
    emptyHistory.classList.remove("hidden");
    return;
  }

  const jobs = await Promise.all(
    jobIds.map(async jobId => {
      try {
        return await fetchJob(jobId);
      } catch {
        return null;
      }
    })
  );

  const validJobs = jobs.filter(Boolean);

  if (!validJobs.length) {
    emptyHistory.classList.remove("hidden");
    return;
  }

  emptyHistory.classList.add("hidden");

  validJobs.forEach(job => {
    historyGrid.appendChild(
      createHistoryCard(job)
    );
  });
}

browseButton.addEventListener("click", event => {
  event.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener("click", () => {
  fileInput.click();
});

dropZone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  selectFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", event => {
  selectFile(event.dataTransfer.files[0]);
});

removeFileButton.addEventListener(
  "click",
  removeSelectedFile
);

presetButtons.forEach(button => {
  button.addEventListener("click", () => {
    presetButtons.forEach(item => {
      item.classList.toggle("active", item === button);
    });

    widthInput.value = button.dataset.width;
    heightInput.value = button.dataset.height;
  });
});

[widthInput, heightInput].forEach(input => {
  input.addEventListener("input", () => {
    presetButtons.forEach(button => {
      button.classList.remove("active");
    });
  });
});

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = `${qualityInput.value}%`;
});

processButton.addEventListener(
  "click",
  processSelectedImage
);

resizeAnotherButton.addEventListener("click", () => {
  removeSelectedFile();

  document.getElementById("resizer").scrollIntoView({
    behavior: "smooth"
  });
});

window.addEventListener("beforeunload", () => {
  if (selectedFileUrl) {
    URL.revokeObjectURL(selectedFileUrl);
  }
});

checkApiHealth();
renderHistory();
setProcessing(false);