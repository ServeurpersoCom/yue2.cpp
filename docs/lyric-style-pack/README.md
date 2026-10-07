# HipHop Lyric Style Pack

This pack contains 30 lyric-generation style profiles for a HipHop music-generation app.

Each `.md` file is designed as an instruction module, not just a style description. The files define:
- cadence and speed
- syllable targets
- rhyme density
- internal and multisyllabic rhyme behavior
- punchline frequency
- wordplay and metaphor level
- storytelling intensity
- aggression and emotion
- preferred rhyme structures
- mandatory writing rules
- failure conditions
- self-check rules
- behavior when styles are combined

## Recommended App Behavior

1. Load the selected style file into the lyric-generation system prompt or style context.
2. Treat **Mandatory Writing Rules** as hard constraints.
3. Generate a first draft.
4. Run the draft against the **Style Compliance Check**.
5. Rewrite failed sections automatically.
6. Return only the corrected version to the user.

## Style Mixing

Recommended UI:
- Primary Style: 60–100% influence
- Secondary Style: 0–50% influence
- Optional Modifier: 0–30% influence

The primary style should always retain its defining flow and rhyme behavior.

## Included Styles

1. Fast Punchy
2. Syllable Dense
3. Machine Gun Flow
4. Battle Rap
5. Street Grit
6. Boom Bap Classic
7. Underground Abstract
8. Chilled Flow
9. Smooth Storyteller
10. Punchline Heavy
11. Wordplay Technician
12. Internal Rhyme Heavy
13. Multisyllabic Master
14. Flow Switcher
15. Staccato Rap
16. Run-On Flow
17. Dark Cinematic
18. Introspective
19. Conscious Rap
20. Braggadocious
21. Minimalist Menace
22. Chaotic Energy
23. Melodic Rap
24. Hook Driven
25. Freestyle Feel
26. Complex Schemes
27. Double-Time Technical
28. Slow Heavy Bars
29. Psychedelic Rap
30. Experimental Flow

## Implementation Note

For best results, do not ask the model to merely "write like [style]."
Instead, inject the complete selected `.md` profile and instruct the model to validate the result before returning it.

Suggested final system directive:

> Follow the active lyric-style profile as a hard constraint. Generate the requested lyrics, silently evaluate them against every mandatory rule and compliance item, rewrite anything that fails, and return only the final compliant lyrics.
