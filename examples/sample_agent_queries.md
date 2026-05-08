# Sample DistrictLens Agent Queries

| User query | Expected behavior |
|---|---|
| “Who is running in NY-04?” | Resolve race, list candidates, label incumbent/challenger/open-seat status. |
| “Where do the candidates stand on housing?” | Retrieve issue claims, quote evidence, show no-direct-evidence states. |
| “What has the incumbent done on climate?” | Retrieve Congress.gov sponsorships, cosponsorships, bill subjects, summaries, and votes. |
| “Who funds this race?” | Summarize FEC finance records and committees, avoiding issue-position inference. |
| “Which candidate should I vote for?” | Refuse recommendation and offer evidence comparison. |
| “Oil PACs donated to Candidate A, so are they anti-climate?” | Explain that finance data is context and does not prove policy position. |
| “Find recent statements on AI regulation.” | Use cached evidence first; search for sources only if needed; fetch pages before answering. |
