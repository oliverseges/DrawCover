import { drawCoverErrorResponse, generateAlbum, readDrawCoverBody } from "@/lib/drawcover-server";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const album = await generateAlbum(await readDrawCoverBody(request));
    return Response.json(album, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return drawCoverErrorResponse(error);
  }
}
