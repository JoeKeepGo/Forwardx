// This fork defaults to the enterprise UI. This controls presentation only;
// existing integrations, account bindings and API permissions are preserved.
export const showCommunityFeatures = (import.meta as any).env?.VITE_FORWARDX_COMMUNITY_UI === "1";
