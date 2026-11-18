import { drawCoverErrorResponse, generateAlbum, readDrawCoverBody } from "@/lib/drawcover-server";
import { localGenerationLimit } from "@/lib/drawcover-local-limit";
import { RECORDING_HEADER } from "@/lib/recording";

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const limited = localGenerationLimit();
    if (limited) return limited;
    const album = await generateAlbum(await readDrawCoverBody(request), request.headers.get(RECORDING_HEADER));
    return Response.json(album, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return drawCoverErrorResponse(error);
  }
}
