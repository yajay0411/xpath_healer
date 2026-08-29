/** The stable shape every downstream step reads. Jenkins' wire format may change; this must not. */
export type TestFailure = {
  className: string;
  testName: string;
  message: string;
  stackTrace: string;
  /** XPaths mentioned by this failure, in the order they appeared. */
  xpaths: string[];
};

export type Diagnosis = {
  xpathRelated: boolean;
  suspectXpaths: string[];
  /** Why we concluded that, in words a human reads in a JIRA ticket. */
  reason: string;
};

export type NormalizedBuildFailure = {
  source: "jenkins";
  event: "build.failed" | "build.succeeded" | "build.unstable";
  occurredAt: string;
  build: {
    job: string;
    number: number | null;
    url: string | null;
    result: string | null;
    durationMs: number | null;
  };
  scm: {
    repoUrl: string | null;
    branch: string | null;
    commit: string | null;
  };
  tests: {
    total: number | null;
    passed: number | null;
    failed: number | null;
    skipped: number | null;
    failures: TestFailure[];
  };
  consoleTail: string | null;
  diagnosis: Diagnosis;
};
