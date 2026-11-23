import { facilis } from "@facilis.dev/nitro/vite";

export default {
  plugins: [facilis()],
  resolve: { alias: { "~": new URL(".", import.meta.url).pathname } },
};
