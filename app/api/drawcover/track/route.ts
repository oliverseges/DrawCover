import { drawCoverErrorResponse, generateAlbumTrack, readDrawCoverBody } from "@/lib/drawcover-server";
import { localGenerationLimit } from "@/lib/drawcover-local-limit";
import { RECORDING_HEADER } from "@/lib/recording";

export const maxDuration = 65;

export async function POST(request: Request) {
  try {
    const limited = localGenerationLimit(true);
    if (limited) return limited;
    const track = await generateAlbumTrack(await readDrawCoverBody(request, true), request.headers.get(RECORDING_HEADER));
    return Response.json(track, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return drawCoverErrorResponse(error);
  }
}
