export type RecognitionResult = {
  label: string;
  confidence: number;
  description: string;
  alternatives: string[];
};

export type RecognizeErrorCode =
  | "invalid_image"
  | "image_too_large"
  | "missing_api_key"
  | "rate_limited"
  | "upstream_error";
