import { HTTPError, defineHandler } from "nitro";

export default defineHandler(() => {
  // SPEC §6.8 / §8.5: dev endpoints are 404 in production.
  if (process.env.NODE_ENV === "production") {
    throw new HTTPError({ status: 404 });
  }
  return {
    revision: "0000000000000000000000000000000000000000",
    generatedAt: new Date(0).toISOString(),
    stub: true,
  };
});
