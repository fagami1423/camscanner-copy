import { fixturesUpToDate, generateFixtures } from '../fixtures/generate';
import { e2eFixturesUpToDate, generateE2eFixtures } from '../fixtures/generate-e2e';

/** Ensure the git-ignored fixtures (PNGs, page.y4m, rotated.jpg) exist before any browser launches. */
export default async function globalSetup(): Promise<void> {
  if (!fixturesUpToDate()) await generateFixtures();
  if (!e2eFixturesUpToDate()) generateE2eFixtures();
}
