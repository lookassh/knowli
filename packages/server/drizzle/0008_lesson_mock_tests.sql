-- Zadanie 17: kartkówka lekcji reużywa kolumny `mock_test_plan` (dyskryminator
-- `kind:"lesson"`) i zapisuje raport per cel w `context.lessonMockTestReport`.
-- Rozszerzamy guard_mock_test_plan(), by uczynić ten raport niezmiennym
-- (utrwalany raz), tak jak `context.mockTestReport` słówek. Zmiana dotyczy
-- WYŁĄCZNIE ciała funkcji triggera — poszerzenie `$type` kolumny jest TS-only
-- i nie emituje SQL (CHECK `learning_sessions_mode_plan` obowiązuje bez zmian).
CREATE OR REPLACE FUNCTION learning_app.guard_mock_test_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode IS DISTINCT FROM OLD.mode OR NEW.mock_test_plan IS DISTINCT FROM OLD.mock_test_plan THEN
    RAISE EXCEPTION 'Session mode and mock test plan are immutable';
  END IF;
  IF OLD.context ? 'mockTestReport' AND (NEW.context->'mockTestReport') IS DISTINCT FROM (OLD.context->'mockTestReport') THEN
    RAISE EXCEPTION 'Closed mock test report is immutable';
  END IF;
  IF OLD.context ? 'lessonMockTestReport' AND (NEW.context->'lessonMockTestReport') IS DISTINCT FROM (OLD.context->'lessonMockTestReport') THEN
    RAISE EXCEPTION 'Closed lesson mock test report is immutable';
  END IF;
  RETURN NEW;
END;
$$;
