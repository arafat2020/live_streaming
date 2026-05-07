# VOD Upload → AWS MediaConvert Integration Guide

## Overview
Replace local FFmpeg VOD transcoding with AWS MediaConvert. Jobs complete asynchronously via EventBridge webhooks.

## Architecture Flow

```
User Upload Video
    ↓
Validate & Create Content record
    ↓
Upload file to S3 → s3://rappio-live-hls/videos/{contentId}/input.mp4
    ↓
Submit MediaConvert Job
    ↓
Store jobId + MediaConvert state in Content.mediaConvertJobId
    ↓
Return 202 ACCEPTED (processing in background)
    ↓
[AWS MediaConvert processes job]
    ↓
EventBridge triggers → POST /internal/vod/mediaconvert-complete
    ↓
VideoService.handleMediaConvertComplete() 
    ↓
Set Content.status = "AVAILABLE"
Set Content.playlistUrl = "https://cloudfront.../videos/{contentId}/master.m3u8"
```

## Database Changes Required

### Update Content/Stream model (Prisma)
Add new fields to track MediaConvert state:

```prisma
model Content {
  // ... existing fields ...
  
  // MediaConvert VOD transcoding state
  mediaConvertJobId    String?    // AWS MediaConvert jobId
  mediaConvertStatus   String?    // SUBMITTED, PROGRESSING, COMPLETE, ERROR
  mediaConvertError    String?    // Error message if job failed
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Run migration:
```bash
npx prisma migrate dev --name add_mediaconvert_tracking
```

## Implementation Steps

### Step 1: Create S3 Upload Helper
File: `src/module/video/s3-upload.helper.ts`

Handles uploading video file to S3 with proper error handling.

### Step 2: Modify VideoController
File: `src/module/video/video.controller.ts`

Update `uploadVideo()` to:
- Upload file to S3
- Submit MediaConvert job
- Return 202 ACCEPTED immediately

### Step 3: Modify VideoService
File: `src/module/video/video.service.ts`

- Remove/deprecate `processLargeVideo()` (local FFmpeg)
- Add `uploadVideoAndSubmitToMediaConvert()`
- Update webhook handler `handleMediaConvertComplete()`

### Step 4: Update Environment Variables
Add to `.env`:
```
# MediaConvert
MEDIACONVERT_REGION=us-east-1
MEDIACONVERT_ENDPOINT=https://mediaconvert.us-east-1.amazonaws.com
S3_BUCKET_NAME=rappio-live-hls
CLOUDFRONT_DOMAIN=https://d31yo5yuqwaqkn.cloudfront.net
```

## Key Decisions

### ✅ Async Processing
- MediaConvert jobs run asynchronously (5-30 min depending on video size)
- Webhook notifies backend when complete
- Client polls `/content/{id}` to check status

### ✅ Error Handling
- If job fails, content status = FAILED
- User can retry upload
- Error details stored in mediaConvertError field

### ✅ Thumbnail Generation
- Generate from uploaded video BEFORE submitting job
- Use AWS Lambda or local FFmpeg (fast, small operation)
- Store thumbnail URL immediately

### ✅ Playback URL
- Once COMPLETE, playlistUrl = `{CLOUDFRONT_DOMAIN}/videos/{contentId}/master.m3u8`
- HLS outputs go to S3 automatically
- CloudFront caches and serves

## Testing Checklist

- [ ] Upload small test video (< 50MB)
- [ ] Verify S3 upload succeeds
- [ ] Verify MediaConvert job created
- [ ] Check AWS console for job progress
- [ ] Receive EventBridge webhook
- [ ] Content status updated to AVAILABLE
- [ ] Playback URL accessible via CloudFront
- [ ] HLS stream plays correctly

## Rollback Plan

If issues occur:
1. Revert to local FFmpeg: Re-enable `processLargeVideo()` method
2. Update controller to call old method instead
3. Deploy hotfix

## Resource Links

- [AWS MediaConvert docs](https://docs.aws.amazon.com/mediaconvert/latest/ug/what-is.html)
- [HLS output format](https://docs.aws.amazon.com/mediaconvert/latest/ug/create-hls-output.html)
- [EventBridge webhooks](https://docs.aws.amazon.com/eventbridge/latest/userguide/custom-event-bus.html)
