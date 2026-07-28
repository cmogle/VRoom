# Working on VROOM together

GitHub Issues are VROOM's shared list of bugs and development requests. The
repository uses one branch only: `main`.

## Report a bug or suggest an improvement

Open a [new issue](https://github.com/cmogle/VRoom/issues/new/choose) and choose
the form that fits. Use one issue for each distinct problem or idea. If an open
issue already covers it, add useful detail there instead of creating a
duplicate.

Screenshots and short recordings are welcome. A request does not need to
describe a technical solution; explaining the desired player experience is
enough.

## Triage the request

Each accepted issue gets:

- one type: `bug`, `enhancement`, or `question`;
- one priority:
  - `priority:P0` — the live game is substantially broken; act immediately;
  - `priority:P1` — the next work to take on;
  - `priority:P2` — planned, but not next;
  - `priority:P3` — an idea for later;
- one readiness label:
  - `ready` — the expected result is clear enough to begin;
  - `needs-info` — a question must be answered first.

Keep P0 rare. Priority describes the order of work, not how strongly the issue
author feels about it.

## Make the change

1. Choose the highest-priority open issue labelled `ready`.
2. Pull the latest `main` and make the focused change directly on `main`.
3. Run the relevant checks before committing.
4. Commit with a concise description and push `main`.
5. Put unrelated requests in new issues rather than expanding the current
   change.

The `main` branch deploys to the live VROOM site, so it should always be in a
working state.

## Ask Codex to pick up the list

For triage:

> Review the open issues in `cmogle/VRoom`. Group them by priority, identify
> anything missing information, and recommend what to work on next. Do not
> change anything yet.

For development:

> Work on the highest-priority open issue labelled `ready` directly on `main`.
> Keep the change focused, run the relevant checks, and commit and push only
> when requested.
