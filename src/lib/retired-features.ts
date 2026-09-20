// Keep old bookmarks and cached clients from reaching removed feature endpoints.
const retiredFeaturePaths = ["/campanha", "/api/campaigns/raffle"];

export function isRetiredFeaturePath(pathname: string) {
  return retiredFeaturePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
