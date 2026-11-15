-- Reverses 0095. Pending confirmation links and open windows are dropped (administrators confirm again
-- after a later upgrade), together with the step-up audit trail.
DROP TABLE api_step_up_audit_events;

DROP TABLE api_step_up_challenges;
