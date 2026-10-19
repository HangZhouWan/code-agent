import type { RoleDefinition } from "@code-agent/protocol";
import { CODE_ROLE } from "./code.js";
import { DOC_ROLE } from "./doc.js";
import { REVIEW_ROLE } from "./review.js";
import { TEST_ROLE } from "./test.js";

export const BUILTIN_ROLES: RoleDefinition[] = [
  CODE_ROLE,
  TEST_ROLE,
  DOC_ROLE,
  REVIEW_ROLE,
];

export { CODE_ROLE, TEST_ROLE, DOC_ROLE, REVIEW_ROLE };
