import { prerender } from "@facilis.dev/nitro/prerender";

export default {
  plugins: [prerender({ routes: ["/", "/about"], origin: "https://fixture.example" })],
};
