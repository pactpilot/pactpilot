export {
  SCHEMA_VERSION,
  type SchemaVersion,
  type Pact,
  type PactScope,
  type Amendment,
} from "./types";

import pactSchema from "../schemas/pact.schema.json";
import amendmentSchema from "../schemas/amendment.schema.json";

/** JSON Schema (draft 2020-12) for base pact files. */
export { pactSchema };

/** JSON Schema (draft 2020-12) for amendment files. */
export { amendmentSchema };
