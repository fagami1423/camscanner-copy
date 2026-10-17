import { fixturesUpToDate, generateFixtures } from '../fixtures/generate';

/** Generate the synthetic CV fixtures on demand (skipped when present and up to date). */
export default async function setup(): Promise<void> {
  if (!fixturesUpToDate()) await generateFixtures();
}
