# Beratungsplan

State: done. Branch: `refactor/beratungsplan`.

Done: Bestehende Profilerfassung zum Planer erweitert; letzter akzeptierter Plan als Sitzungskontext. XState validiert Vorschläge und fällt bei ungültigem Plan auf die bisherige Schrittwahl zurück. Berechnungsauftrag und Ergebnisdarstellung getrennt. Gesprächsführer erhält nur ausgewählte Ergebnisse; höchstens eine Rückfrage. Ungenutzten RisikoRechner-Alias und wirkungslose Status-Verzweigung entfernt. Testeinstieg führt einzelne Tests tatsächlich aus.

Checks: Backend-Tests und Typecheck, Angular-Produktionsbuild. Modellantworten und APICalc sind in Tests simuliert; keine Live-Qualitätsmessung dieses Umbaus. Keine neuen Dependencies.

Next: Nach Server-Neustart neuen Chat mit synthetischer Familie führen. Prüfen: kurze Antworten, Zielwechsel, Einkommenskorrektur, Hauskauf vs. Familienabsicherung. Produktquellen und Zeitstrahl sind weitere Aufgaben. Details und Fallbackverhalten stehen in `code/backend/BERATUNGSSTAND.md`.

Hinweis: Auf vorhandenen uncommitteten Profil-, Berechnungs- und Frontendänderungen aufgebaut; diese werden auf Wunsch gemeinsam auf dem Branch gespeichert.
