variable "aws_region" {
  description = "AWS region — choose one close to your server and most of your streamers"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "Your AWS account ID (12-digit number)"
  type        = string
}

variable "s3_bucket_name" {
  description = "S3 bucket name for HLS segments — must be globally unique"
  type        = string
  default     = "rappio-live-hls"
}

variable "nestjs_public_url" {
  description = "Public HTTPS URL of your NestJS server — EventBridge will POST to this"
  type        = string
  # e.g. "https://api.rappio.tv"
}

variable "webhook_secret" {
  description = "Secret token to verify EventBridge webhook calls in NestJS"
  type        = string
  sensitive   = true
}

variable "r2_public_domain" {
  description = "Cloudflare R2 public bucket hostname (without https://) — e.g. pub-xxxx.r2.dev"
  type        = string
  # e.g. "pub-e4c5ac538f734060aafd26b4abc05fc5.r2.dev"
}

# in variables.tf
variable "rtmp_allowed_cidr" {
  description = "CIDR block allowed to push RTMP to MediaLive (your NMS server IP)"
  type        = string
  default     = "0.0.0.0/0"  # Lock this down in production to your server's IP
}
