import { drawCoverErrorResponse, savedRecording } from "@/lib/drawcover-server";

export async function GET(request: Request) {
  try {
    return await savedRecording(new URL(request.url).searchParams.get("id"));
  } catch (error) {
    return drawCoverErrorResponse(error);
  }
}
