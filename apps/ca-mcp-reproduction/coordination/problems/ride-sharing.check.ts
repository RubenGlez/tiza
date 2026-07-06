// Deterministic sanity check for the ride-sharing checker. No API calls.
import { makeRideSharing } from "./ride-sharing";

function show(label: string, plan: Record<string, unknown>, dynamic: boolean) {
  const p = makeRideSharing({ dynamic });
  if (dynamic) p.disruption?.apply(p); // simulate post-disruption state
  const r = p.check(plan);
  console.log(
    `${label}: ${r.pass ? "PASS" : "FAIL"}${r.violations.length ? ` — ${r.violations.join("; ")}` : ""}`,
  );
}

const valid = {
  "vehicle-1": { passengers: ["P1", "P2"] },
  "vehicle-2": { passengers: ["P3", "P4"] },
  "vehicle-3": { passengers: [] },
};
const cross = {
  "vehicle-1": { passengers: ["P1", "P3"] },
  "vehicle-2": { passengers: ["P2", "P4"] },
  "vehicle-3": { passengers: [] },
};
const dbl = {
  "vehicle-1": { passengers: ["P1", "P2"] },
  "vehicle-2": { passengers: ["P1", "P3"] },
  "vehicle-3": { passengers: ["P4"] },
};
const split = {
  "vehicle-1": { passengers: ["P1", "P2"] },
  "vehicle-2": { passengers: ["P3"] },
  "vehicle-3": { passengers: ["P4"] },
};

console.log("--- static (P3) ---");
show("valid {P1,P2}+{P3,P4}", valid, false);
show("cross {P1,P3}+{P2,P4}", cross, false);
show("double-book P1", dbl, false);
show("split {P1,P2}+P3+P4", split, false);

console.log("--- dynamic (P4), post-disruption ---");
show("old plan {P1,P2}+{P3,P4}", valid, true);
show("recovery {P1,P2}+P3+P4", split, true);
