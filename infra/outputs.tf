output "s3_bucket_name" {
  description = "S3 bucket name — set as S3_BUCKET in NestJS env"
  value       = aws_s3_bucket.live_hls.id
}

output "cloudfront_domain" {
  description = "CloudFront URL — set as CLOUDFRONT_URL in NestJS env (this is your new playback base URL)"
  value       = "https://${aws_cloudfront_distribution.live_hls.domain_name}"
}

output "medialive_role_arn" {
  description = "MediaLive IAM role ARN — set as MEDIALIVE_ROLE_ARN in NestJS env"
  value       = aws_iam_role.medialive.arn
}

output "mediaconvert_role_arn" {
  description = "MediaConvert IAM role ARN — set as MEDIACONVERT_ROLE_ARN in NestJS env"
  value       = aws_iam_role.mediaconvert.arn
}

output "nestjs_medialive_policy_arn" {
  description = "Attach this policy to your NestJS server's IAM user or role (MediaLive)"
  value       = aws_iam_policy.nestjs_medialive.arn
}

output "nestjs_mediaconvert_policy_arn" {
  description = "Attach this policy to your NestJS server's IAM user or role (MediaConvert)"
  value       = aws_iam_policy.nestjs_mediaconvert.arn
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — useful for cache invalidation"
  value       = aws_cloudfront_distribution.live_hls.id
}

