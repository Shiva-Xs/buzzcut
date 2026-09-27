Let the cafe planner order a meal more than once

Each meal could only be added once, at quantity 1; the spec listed repeat orders as the workshop extension. This adds them, keeping one row per meal: repeat orders raise its quantity.

- After "Add to plan", a meal card shows an −/quantity/+ stepper and an "In plan" badge instead of the disabled "Added" button; − at quantity 1 removes the row
- The live plan panel gets the same stepper and a Remove button per line, and shows servings per batch and in total for each dish
- `CafePlanner` holds `incrementLineQuantity`, `decrementLineQuantity` and `removeLine`; totals still come from `summarizePlan(planLines)`, which already scaled cost and servings by quantity
- The spec describes this as shipped behavior; extra diet filters and a visible total cost stay in Phase 2

Tested: a screen recording of add, +/−, a second meal, and the panel's +/− and Remove ([demo](https://cursor.com/agents/bc-7ce603fb-a12d-4729-86c6-ef56f293c2ec/artifacts?path=%2Fopt%2Fcursor%2Fartifacts%2Fcafe-planner-multi-qty-demo.mp4)). No automated tests ran.
