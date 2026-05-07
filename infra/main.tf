terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─────────────────────────────────────────
# S3 — HLS segment storage
# ─────────────────────────────────────────

resource "aws_s3_bucket" "live_hls" {
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_cors_configuration" "live_hls" {
  bucket = aws_s3_bucket.live_hls.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_public_access_block" "live_hls" {
  bucket = aws_s3_bucket.live_hls.id

  # CloudFront accesses via OAC — bucket stays private
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "live_hls" {
  bucket = aws_s3_bucket.live_hls.id

  # Delete live segments after 24h — they're only needed while stream is live
  rule {
    id     = "expire-live-segments"
    status = "Enabled"

    filter {
      prefix = "live/"
    }

    expiration {
      days = 1
    }
  }

  # Keep VOD content for 1 year
  rule {
    id     = "expire-vod"
    status = "Enabled"

    filter {
      prefix = "videos/"
    }

    expiration {
      days = 365
    }
  }
}

# ─────────────────────────────────────────
# CloudFront OAC — lets CloudFront read S3
# without making the bucket public
# ─────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "live_hls" {
  name                              = "rappio-live-hls-oac"
  description                       = "OAC for Rappio live HLS bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# S3 bucket policy — only CloudFront OAC can read
resource "aws_s3_bucket_policy" "live_hls" {
  bucket = aws_s3_bucket.live_hls.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.live_hls.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.live_hls.arn
          }
        }
      },
      # MediaLive needs PutObject to write HLS segments
      {
        Sid    = "AllowMediaLiveWrite"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.medialive.arn
        }
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.live_hls.arn,
          "${aws_s3_bucket.live_hls.arn}/*"
        ]
      }
    ]
  })

  depends_on = [aws_cloudfront_distribution.live_hls]
}

# ─────────────────────────────────────────
# CloudFront distribution
# ─────────────────────────────────────────

resource "aws_cloudfront_cache_policy" "hls_segments" {
  name        = "rappio-hls-segments"
  comment     = "Cache .ts segments long, .m3u8 playlists briefly"
  default_ttl = 86400
  max_ttl     = 31536000
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_cache_policy" "hls_playlist" {
  name        = "rappio-hls-playlist"
  comment     = "Short TTL for live .m3u8 playlists"
  default_ttl = 2
  max_ttl     = 5
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
  }
}

resource "aws_cloudfront_distribution" "live_hls" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Rappio live HLS delivery"
  price_class     = "PriceClass_All"

  origin {
    domain_name              = aws_s3_bucket.live_hls.bucket_regional_domain_name
    origin_id                = "S3-rappio-live-hls"
    origin_access_control_id = aws_cloudfront_origin_access_control.live_hls.id
  }

  # Default behaviour — .ts segments (long cache)
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-rappio-live-hls"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.hls_segments.id
  }

  # .m3u8 playlists — short TTL so live viewers get fresh segments
  ordered_cache_behavior {
    path_pattern           = "*.m3u8"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-rappio-live-hls"
    viewer_protocol_policy = "redirect-to-https"
    compress               = false
    cache_policy_id        = aws_cloudfront_cache_policy.hls_playlist.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# ─────────────────────────────────────────
# IAM — MediaLive service role
# ─────────────────────────────────────────

resource "aws_iam_role" "medialive" {
  name = "rappio-medialive-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "medialive.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "medialive_s3" {
  name = "rappio-medialive-s3-policy"
  role = aws_iam_role.medialive.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.live_hls.arn,
          "${aws_s3_bucket.live_hls.arn}/*"
        ]
      },
      # MediaLive needs SSM to read secure parameters (optional but recommended)
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/rappio/*"
      }
    ]
  })
}

# IAM policy for your NestJS app to call MediaLive APIs
resource "aws_iam_policy" "nestjs_medialive" {
  name        = "rappio-nestjs-medialive-policy"
  description = "Allows NestJS backend to create/start/stop MediaLive channels"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "medialive:CreateChannel",
          "medialive:DeleteChannel",
          "medialive:StartChannel",
          "medialive:StopChannel",
          "medialive:DescribeChannel",
          "medialive:CreateInput",
          "medialive:DeleteInput",
          "medialive:DescribeInput",
          "medialive:ListChannels",
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─────────────────────────────────────────
# IAM — MediaConvert VOD transcoding
# ─────────────────────────────────────────

resource "aws_iam_role" "mediaconvert" {
  name = "rappio-mediaconvert-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "mediaconvert.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "mediaconvert_s3" {
  name = "rappio-mediaconvert-s3-policy"
  role = aws_iam_role.mediaconvert.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.live_hls.arn,
          "${aws_s3_bucket.live_hls.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.live_hls.arn}/videos/*"
      }
    ]
  })
}

# Update NestJS policy to also allow MediaConvert calls
resource "aws_iam_policy" "nestjs_mediaconvert" {
  name        = "rappio-nestjs-mediaconvert-policy"
  description = "Allows NestJS backend to submit MediaConvert VOD jobs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
          "mediaconvert:ListJobs",
          "mediaconvert:DescribeEndpoints",
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}


# ─────────────────────────────────────────
# EventBridge — fires when MediaLive channel
# state changes (RUNNING = stream is live)
# ─────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "medialive_running" {
  name        = "rappio-medialive-channel-running"
  description = "Fires when a MediaLive channel enters RUNNING state"

  event_pattern = jsonencode({
    source      = ["aws.medialive"]
    detail-type = ["MediaLive Channel State Change"]
    detail = {
      state = ["RUNNING"]
    }
  })
}

resource "aws_cloudwatch_event_rule" "medialive_stopped" {
  name        = "rappio-medialive-channel-stopped"
  description = "Fires when a MediaLive channel enters IDLE state (stopped)"

  event_pattern = jsonencode({
    source      = ["aws.medialive"]
    detail-type = ["MediaLive Channel State Change"]
    detail = {
      state = ["IDLE"]
    }
  })
}

# EventBridge target — your NestJS webhook
resource "aws_cloudwatch_event_target" "nestjs_running" {
  rule     = aws_cloudwatch_event_rule.medialive_running.name
  arn      = aws_cloudwatch_event_api_destination.nestjs.arn
  role_arn = aws_iam_role.eventbridge_invoke.arn

  http_target {
    header_parameters = {
      "X-Webhook-Secret" = var.webhook_secret
    }
  }
}

resource "aws_cloudwatch_event_target" "nestjs_stopped" {
  rule     = aws_cloudwatch_event_rule.medialive_stopped.name
  arn      = aws_cloudwatch_event_api_destination.nestjs.arn
  role_arn = aws_iam_role.eventbridge_invoke.arn

  http_target {
    header_parameters = {
      "X-Webhook-Secret" = var.webhook_secret
    }
  }
}

# API Destination — points EventBridge at your NestJS server
resource "aws_cloudwatch_event_api_destination" "nestjs" {
  name                             = "rappio-nestjs"
  description                      = "Rappio NestJS webhook endpoint"
  invocation_endpoint              = "${var.nestjs_public_url}/internal/stream/medialive-event"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 300
  connection_arn                   = aws_cloudwatch_event_connection.nestjs.arn
}

# API Destination for MediaConvert webhooks
resource "aws_cloudwatch_event_api_destination" "nestjs_mediaconvert" {
  name                             = "rappio-nestjs-mediaconvert"
  description                      = "Rappio NestJS MediaConvert webhook endpoint"
  invocation_endpoint              = "${var.nestjs_public_url}/internal/vod/mediaconvert-complete"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 300
  connection_arn                   = aws_cloudwatch_event_connection.nestjs.arn
}

resource "aws_cloudwatch_event_connection" "nestjs" {
  name               = "rappio-nestjs-connection"
  description        = "Auth for NestJS webhook"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Webhook-Secret"
      value = var.webhook_secret
    }
  }
}

resource "aws_iam_role" "eventbridge_invoke" {
  name = "rappio-eventbridge-invoke-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "eventbridge_invoke" {
  name = "rappio-eventbridge-invoke-policy"
  role = aws_iam_role.eventbridge_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "events:InvokeApiDestination"
        Resource = aws_cloudwatch_event_api_destination.nestjs.arn
      }
    ]
  })
}

# ─────────────────────────────────────────
# EventBridge — fires when MediaConvert
# VOD job completes (COMPLETE or ERROR)
# ─────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "mediaconvert_complete" {
  name        = "rappio-mediaconvert-complete"
  description = "Fires when a MediaConvert VOD job completes or fails"

  event_pattern = jsonencode({
    source      = ["aws.mediaconvert"]
    detail-type = ["MediaConvert Job State Change"]
    detail = {
      status = ["COMPLETE", "ERROR"]
    }
  })
}

# EventBridge target — your NestJS webhook for MediaConvert completion
resource "aws_cloudwatch_event_target" "nestjs_mediaconvert" {
  rule     = aws_cloudwatch_event_rule.mediaconvert_complete.name
  arn      = aws_cloudwatch_event_api_destination.nestjs_mediaconvert.arn
  role_arn = aws_iam_role.eventbridge_invoke.arn

  http_target {
    header_parameters = {
      "X-Webhook-Secret" = var.webhook_secret
    }
  }

  input_transformer {
    input_paths = {
      jobId         = "$.detail.jobId"
      status        = "$.detail.status"
      contentId     = "$.detail.userMetadata.contentId"
    }
    input_template = jsonencode({
      jobId     = "<jobId>"
      status    = "<status>"
      contentId = "<contentId>"
    })
  }
}
