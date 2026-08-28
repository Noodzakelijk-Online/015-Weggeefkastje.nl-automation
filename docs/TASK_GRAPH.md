# Task graph

```text
repository audit
  -> architecture + data model + migration
    -> auth/ownership/config safety
      -> API + state machine + audit
        -> worker + provider adapters + retries
        -> dashboard + review + manual posting gate
          -> critical-path and adversarial tests
            -> Docker/CI/backup/doctor
              -> browser/manual verification
                -> final matrix and release
```

The only external branch is provider acceptance: Facebook credentials/Page approval or a Nextdoor-approved export can be added without blocking local manual operation. External posting deliberately stays outside the automation boundary.
