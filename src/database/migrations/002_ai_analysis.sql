-- Análisis con IA de una corrida terminada. Se guarda una sola vez porque la
-- corrida ya no cambia, y así no se gasta la cuota gratuita de la IA dos veces.
ALTER TABLE test_runs ADD COLUMN ai_analysis JSONB;
