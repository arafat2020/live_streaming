# Rappio Video Streaming Architecture

This document explains how the different cloud components (AWS MediaLive, MediaConvert, S3, CloudFront) and the NestJS backend work together to power the live streaming and VOD platform.

---

## 1. Live Streaming Pipeline (Real-Time)

The live streaming flow uses a **"Relay & Transcode"** architecture to ensure stability and high-quality multi-bitrate delivery.

### Data Flow:
1.  **Ingest (Creator):** A creator pushes an RTMP stream from OBS to your VPS (`rtmp://api.rappio.tv/live/{streamKey}`).
2.  **Detection (NestJS):** The `MediaServerService` (on the VPS) detects the incoming stream.
3.  **Provisioning (AWS MediaLive):** NestJS calls `MediaLiveService` to create a dedicated **MediaLive Input** and **Channel**.
4.  **Relay (FFmpeg):** The VPS spawns an FFmpeg process that copies the local RTMP stream and "pushes" it to the AWS MediaLive entry point.
5.  **Transcoding (AWS):** MediaLive takes the single high-quality stream and converts it into 3 renditions (1080p, 720p, 480p).
6.  **Storage (S3):** MediaLive writes the resulting HLS segments (`.ts`) and playlists (`.m3u8`) into the `rappio-live-hls` S3 bucket under the `/live/{contentId}/` prefix.
7.  **Delivery (CloudFront):** Users watch the stream via CloudFront: `https://cdn.rappio.tv/live/{contentId}/master.m3u8`.

### Event Loop (The "Live" Signal):
- When MediaLive reaches the `RUNNING` state, **AWS EventBridge** fires a webhook to your backend.
- NestJS receives the webhook, marks the stream as `LIVE` in the database, and broadcasts the event to all users via **Socket.io**.

---

## 2. VOD Pipeline (Video on Demand)

The VOD flow handles recorded video uploads (like lessons or clips) and ensures they are playable on all devices.

### Data Flow:
1.  **Upload:** A user uploads a video file via the `VideoController`.
2.  **Staging:** The file is temporarily stored on the VPS and then uploaded to a "Raw Uploads" folder in S3.
3.  **Transcoding (MediaConvert):** NestJS triggers an **AWS MediaConvert** job.
4.  **Processing:** MediaConvert converts the file into a multi-bitrate HLS package.
5.  **Storage:** The final HLS files are written to S3 under the `/videos/{contentId}/` prefix.
6.  **Notification:** Once finished, EventBridge sends a `COMPLETE` webhook to NestJS.
7.  **Availability:** NestJS marks the video as `AVAILABLE`, and it becomes playable via CloudFront.

---

## 3. Infrastructure & Routing (The Gateway)

### CloudFront (The Traffic Controller)
CloudFront is the "front door" for all video traffic. It uses **Cache Behaviors** to decide where to get the data:
- **Paths starting with `/live/*`:** Routed to the **AWS S3 Bucket** (Live Streams).
- **Paths starting with `/videos/*`:** Routed to **Cloudflare R2** (VOD & Static Content).
- **Security:** Uses **Origin Access Control (OAC)** so that your S3 buckets can stay private. No one can bypass CloudFront to access your data directly.

### AWS EventBridge (The Nervous System)
EventBridge monitors your AWS account for state changes. It is configured with **API Destinations** to hit your NestJS webhooks:
- **Rule 1:** Fires when a MediaLive channel starts.
- **Rule 2:** Fires when a MediaLive channel stops/crashes.
- **Rule 3:** Fires when a MediaConvert job finishes.

---

## 4. Key Components Table

| Component | Responsibility |
| :--- | :--- |
| **Node Media Server** | Ingests the raw stream from the creator (OBS). |
| **FFmpeg Relay** | Bridges the gap between your VPS and AWS Cloud. |
| **AWS MediaLive** | Performs the heavy lifting of real-time video encoding. |
| **AWS MediaConvert** | Handles file-based transcoding for recorded videos. |
| **Amazon S3** | The "Origin" storage for all HLS video segments. |
| **Amazon CloudFront** | The Global CDN that delivers video with low latency. |
| **NestJS Backend** | Orchestrates the entire lifecycle and notifies the Frontend. |

---

## 5. Troubleshooting the Pipeline

- **Stream not "Live" in UI:** Check if the EventBridge webhook hit the backend (`docker compose logs app`).
- **404 in Player:** Check if CloudFront is correctly routing the `/live/` path to S3 (Verify `infra/main.tf`).
- **AWS Service Limits:** If streams fail to start, run `npm run cleanup:medialive` to delete orphaned AWS resources.
