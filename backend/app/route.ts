export function GET(request: Request) {
  return Response.redirect(new URL('/frontend/index.html', request.url))
}
