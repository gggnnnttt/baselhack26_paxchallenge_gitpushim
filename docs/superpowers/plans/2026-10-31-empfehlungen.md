# KI-Auswahl von Vorsorgeprodukten

Aktuelle Nutzervorgabe ersetzt die ursprüngliche regelbasierte Auswahl: Das Modell entscheidet anhand akzeptierter Profilwerte, aktueller Berechnungen, bestehender privater Absicherung und des vollständigen allgemeinen Produktkatalogs selbst über Auswahl, Reihenfolge und Begründung. Das Backend validiert Format, Katalog-IDs und Datenbezüge und ergänzt unveränderte Produktmerkmale. Es gibt keinen regelbasierten Ersatz bei Modellfehlern. Der vorhandene EU-Modellvergleich bleibt als Datenquelle und bestehende Kompatibilität erhalten; er steuert die Empfehlungsseite nicht.

Keine vertraulichen Dokumente, Mitarbeiternamen oder Kontaktangaben übernehmen. Commit und Push wurden anschliessend ausdrücklich vom Nutzer freigegeben. Keine Eingriffe in laufende Server.

Erledigt: KI-Auswahl, Antwortvalidierung, lesbare Datengrundlagen, UI ohne Regel-IDs, Revisionscache und Fehlerzustand. Tests prüfen freie Auswahl bei identischen Daten, unbekannte Produkte/Datenquellen, vertrauliche Kontakte, Modellfehler, bewusste Entscheidung gegen zusätzliche Produkte sowie Cache und Session-Lebenszyklus.

Abschlussreview: Ein KI-Entscheid gegen einen Abschluss wird nicht als berechnete Null-Lücke dargestellt. Irrelevante Partner-Szenarien werden vor allen KI-Datenquellen auf einer Kopie entfernt; Regressionstest reproduziert den Fehler und prüft unveränderte Sessiondaten.
