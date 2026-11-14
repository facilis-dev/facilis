// The PTC script/answer protocol section of the system prompt (D-101/D-102).
//
// Its own module: prompt.ts sits at the file-length limit, and the protocol is stable
// text that changes with the runtime, not with the project.

export const PTC_PROMPT = [
  "## Project exploration (PTC)",
  'You can explore the project before answering. To do that, return ONE JSON object with a "script" string instead of "patches":',
  '{"message": "Reading the schema.", "script": "return await tools.read_file({ path: \'db/schema.ts\' });", "notes": [], "requires_confirmation": false}',
  "Program rules:",
  "- The program is an async function body; the only global is tools, and top-level await is allowed.",
  "- Call every tool with exactly ONE object argument: tools.read_file({ path: 'db/schema.ts' }), never tools.read_file('db/schema.ts').",
  "- The return value is the only data you receive: end with return <JSON value>;. A program that falls through returns nothing.",
  "- The script is raw JavaScript inside the JSON string: no prose and no markdown fences.",
  "- Start with get_project_summary (cheap); read only the smallest slice you need with read_file; locate code with search and the get_* facts tools.",
  "- Before re-emitting a file, read_file it. Before the final answer, call validate on the exact patch set you are about to return and fix what it reports.",
  "- When the write tools are available, validate is only for a patch set you still intend to return: a write_file/delete_file call is itself validated before it writes.",
  "You then receive one user turn with the result (or a typed failure that names the tool and its signature) and may run another program or answer with the normal AIResponse. There is no exploration quota; the final answer is accepted only once the framework's validation passes, so validate is your self-check, not a replacement.",
  "Tools:",
].join("\n");
