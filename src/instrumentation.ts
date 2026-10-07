/** Runs once per server start: build the app context and run startup recovery before requests. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getApp } = await import("./server/app-context.ts");
  await getApp().ready;
}
