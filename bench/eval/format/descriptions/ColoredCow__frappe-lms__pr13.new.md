fix: clear the quiz answer selection when moving to the next question

Fixes #287: after Check → Next in a quiz, the next question still showed the previous answer selected. `resetQuestion()` reset `selectedOptions` to `[0,0,0,0]`, but the radio and checkbox inputs had no `:checked` binding, so Vue never cleared them. Both inputs in `Quiz.vue` now bind `:checked="selectedOptions[index - 1] === 1"`.

That fix is 2 lines. The other ~1,000 lines are upstream's demo-data work (frappe/lms#2159), which this branch carries:

- `lms/demo/demo_data.py` creates the demo course "A guide to Frappe Learning" with chapters, lessons, a quiz, an instructor, students, reviews and progress, and runs after the setup wizard (`setup_wizard_complete`)
- A "Clear Demo Data" item in the user menu, shown while `demo_data_present` is set, calls `lms.lms.api.clear_demo_data`; analytics and the persona check skip the demo course
- `frappe/payments` becomes a required app and is installed in CI; the workspace sidebar JSON goes; the Cypress course test finds its course by title

Not tested: answer Q1 of a multi-question quiz, Check → Next, and check Q2 starts with nothing selected, for single- and multiple-answer questions, and that answers still submit.
