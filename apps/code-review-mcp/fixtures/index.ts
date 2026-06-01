export interface Fixture {
  name: string;
  title: string;
  description: string;
  diff: string;
}

export {
  PR_DESCRIPTION as API_DESC,
  PR_DIFF as API_DIFF,
  PR_TITLE as API_TITLE,
} from "./api-routes";
export {
  PR_DESCRIPTION as AUTH_DESC,
  PR_DIFF as AUTH_DIFF,
  PR_TITLE as AUTH_TITLE,
} from "./auth-module";
export {
  PR_DESCRIPTION as DATA_DESC,
  PR_DIFF as DATA_DIFF,
  PR_TITLE as DATA_TITLE,
} from "./data-layer";

import { PR_DESCRIPTION as d3, PR_DIFF as diff3, PR_TITLE as t3 } from "./api-routes";
import { PR_DESCRIPTION as d1, PR_DIFF as diff1, PR_TITLE as t1 } from "./auth-module";
import { PR_DESCRIPTION as d2, PR_DIFF as diff2, PR_TITLE as t2 } from "./data-layer";
import { PR_DESCRIPTION as d4, PR_DIFF as diff4, PR_TITLE as t4 } from "./full-auth-system";

export const FIXTURES: Fixture[] = [
  { name: "auth-module", title: t1, description: d1, diff: diff1 },
  { name: "data-layer", title: t2, description: d2, diff: diff2 },
  { name: "api-routes", title: t3, description: d3, diff: diff3 },
  { name: "full-auth-system", title: t4, description: d4, diff: diff4 },
];
