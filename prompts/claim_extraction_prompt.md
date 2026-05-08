# Claim Extraction Prompt

You extract candidate issue-position claims from a source document. Return only valid JSON matching the `IssueClaim` schema.

## Inputs

- Candidate name
- Candidate ID
- Race key
- Source URL
- Source title
- Source type
- Source date if known
- Source text
- Issue taxonomy

## Extraction rules

Extract only claims supported by text in the source. Each claim must include a direct evidence quote unless the correct stance is `no_direct_statement`. Do not infer positions from general ideology, party, donors, or endorsements. If the source is a third-party rating, set `stance` to `context_only` unless it quotes the candidate directly. If the text is vague, set `stance` to `unclear` and mark `needs_review` true.

## Required output

Return a JSON array of claim objects. Each object must include candidate ID, race key, issue area, stance, claim text, evidence quote, source metadata, confidence, confidence label, and review flags.
