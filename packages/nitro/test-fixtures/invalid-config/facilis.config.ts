// A config file that exists but does not satisfy the contract: the Vite plugin must name
// the file and fail the start instead of booting Nitro with silently wrong options.
export default { auth: { defaultRole: "user" } };
