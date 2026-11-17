import { drawCoverErrorResponse, generateAlbumTrack, readDrawCoverBody } from "@/lib/drawcover-server";

export const maxDuration = 65;

export async function POST(request: Request) {
  try {
    const track = await generateAlbumTrack(await readDrawCoverBody(request, true));
    return Response.json(track, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return drawCoverErrorResponse(error);
  }
}
