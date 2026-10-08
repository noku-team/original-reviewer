# Changelog

## [0.1.2](https://github.com/noku-team/original-reviewer/compare/v0.1.1...v0.1.2) (2026-10-08)


### Features

* add createReviewComment method to GitHost and implement comment posting in publishReview ([45cb262](https://github.com/noku-team/original-reviewer/commit/45cb262f6d334b2e25c98ced15924cd093e7e65b))
* improve suggested fix formatting in comments ([83c07fc](https://github.com/noku-team/original-reviewer/commit/83c07fcdbc8ea22238ff5168ab2a24924628d847))

## [0.1.1](https://github.com/noku-team/original-reviewer/compare/v0.1.0...v0.1.1) (2026-10-08)


### Features

* enhance error handling and logging in original client and run job ([85b4b89](https://github.com/noku-team/original-reviewer/commit/85b4b89e8c1e2b202f056476bb3316bfa9329c10))

# 0.1.0 (2026-10-08)


### Bug Fixes

* improve token retrieval logic in GitHub host function ([1ec80a4](https://github.com/noku-team/original-reviewer/commit/1ec80a49023d92331933830000c788af25453576))
* omit unset forkRepo so CI typecheck passes ([a6a60f8](https://github.com/noku-team/original-reviewer/commit/a6a60f876482b58e408e9a1b510a78871fc248cd))
* update redirect URL in connect route to point to GitHub installation settings ([fa64d05](https://github.com/noku-team/original-reviewer/commit/fa64d0562af1573596c58118a47f5f83af8e2ea7))
* wire graph slice, job isolation, and review error checks ([616aee4](https://github.com/noku-team/original-reviewer/commit/616aee45543fde105f9257250023d1f0033f0316))


### Features

* accept GitHub App webhooks and enqueue jobs ([85fe308](https://github.com/noku-team/original-reviewer/commit/85fe308ea9562e58eefac37da2de54307356c047))
* add .env.example and CI workflow, enhance linting and type safety ([7fb8cb8](https://github.com/noku-team/original-reviewer/commit/7fb8cb87475ed378a5a530cc5a116dab63cb6fbf))
* add listIssueComments method and improve command handling ([a7a09b4](https://github.com/noku-team/original-reviewer/commit/a7a09b4b53193333f77b987736e3b0f99903fce1))
* add new release workflow and deployment process ([1dc66ad](https://github.com/noku-team/original-reviewer/commit/1dc66adecfcac51121e0324f8cc901cf992b73e6))
* add production Docker image for k8s ([9df4e22](https://github.com/noku-team/original-reviewer/commit/9df4e22e89ec7bc4b66f61b3cca5ce180e68d17e))
* assemble Original payloads under the byte budget ([96d67bb](https://github.com/noku-team/original-reviewer/commit/96d67bbc3e412c6f958fca38a6a5fa142d494024))
* call Original responses API with conversation id ([c6a7bc7](https://github.com/noku-team/original-reviewer/commit/c6a7bc75f25e09b362a2897a2f528d50b375e274))
* connect Original accounts and ship the default review skill ([fea623c](https://github.com/noku-team/original-reviewer/commit/fea623c4262fdb7b0568f7f35bcf17e717f4e05e))
* drop findings that are not on the pull request diff ([75d7c6a](https://github.com/noku-team/original-reviewer/commit/75d7c6a1931b3496c10d8946477afb95e6fdfc35))
* enhance connect route to display connection status for GitHub installations ([6a69ce4](https://github.com/noku-team/original-reviewer/commit/6a69ce48e7e112dc8b3b63fd1931bd68de8d17a7))
* enhance connect scope handling and improve JSON parsing ([498a6b6](https://github.com/noku-team/original-reviewer/commit/498a6b68ada695592c75f1c2607686dd409e7289))
* enhance credential management with Redis support and improve error handling ([edfa1db](https://github.com/noku-team/original-reviewer/commit/edfa1db2fe134591e45e23c8e55c8556b7dd28a4))
* enhance GitHub host and server functionality with pull request base SHA support ([be0b779](https://github.com/noku-team/original-reviewer/commit/be0b779eb6f27702a99122eeff95fd742494b8be))
* enhance GitHub integration with HTTP basic authentication support ([3eaef68](https://github.com/noku-team/original-reviewer/commit/3eaef683eca97d97061127083fd3a3c8c880bdc3))
* enhance GitHub integration with pull request support and guidelines loading ([ffb6fc8](https://github.com/noku-team/original-reviewer/commit/ffb6fc88bc7741b2b100e6d250354c84e0e73f67))
* enhance README with sequence and flowchart diagrams ([3c1e0cc](https://github.com/noku-team/original-reviewer/commit/3c1e0cc253f05423746a6c5a9a45bd560ea830e8))
* enqueue review jobs and cancel superseded SHAs ([0e9586e](https://github.com/noku-team/original-reviewer/commit/0e9586ecd4218d12db9f40798c1ffc2ffbbb1abb))
* enqueue review jobs and cancel superseded SHAs ([649d3f7](https://github.com/noku-team/original-reviewer/commit/649d3f797dac00fc766d43c465356644d5e33dde))
* implement PKCE support in OAuth flow and update environment configuration ([423f514](https://github.com/noku-team/original-reviewer/commit/423f5142e43b23f0b2871df8abe64558f13dc54f))
* parse .original-reviewer.yaml with default ignores ([c706211](https://github.com/noku-team/original-reviewer/commit/c7062119d5e614133da339bff895f6a0257a8e73))
* parse [@original-reviewer](https://github.com/original-reviewer) review commands ([13d54e3](https://github.com/noku-team/original-reviewer/commit/13d54e37b61aa547dde4b23b701fbfbcd7cc77b4))
* parse Original pr_review JSON schema ([cc8c239](https://github.com/noku-team/original-reviewer/commit/cc8c239920c379e594376e009e0312c2acf46db2))
* persist graphify output on refs/original-reviewer/graph ([964d7a7](https://github.com/noku-team/original-reviewer/commit/964d7a7b5e4529668081b29c6717f563b654ce4f))
* publish GitHub reviews and original-reviewer check runs ([bae0f44](https://github.com/noku-team/original-reviewer/commit/bae0f442bf689587433ee19bf7aead55d94affdf))
* run graphify AST update without an LLM key ([33eff81](https://github.com/noku-team/original-reviewer/commit/33eff8166b4dd90441718b002cfa8cb0c22df094))
* run review jobs with Original auth and graph persistence ([3628c4c](https://github.com/noku-team/original-reviewer/commit/3628c4cb0b19c72cf458d8770b1e8536f3e7e265))
* store Original conversation id on the pull request ([9e7ed9d](https://github.com/noku-team/original-reviewer/commit/9e7ed9d7e58d9562d86625ee0d0d4eee1f6270c8))
* update .env.example and add logo asset ([2a13314](https://github.com/noku-team/original-reviewer/commit/2a1331450718e2a4c1200a837b5d233b8411fd80))
* update connect scope handling and improve error messaging for OAuth failures ([6bf2e43](https://github.com/noku-team/original-reviewer/commit/6bf2e43eb8d2b9c0348c247befc733a448afcf35))
* update release workflow and package configurations ([aeec284](https://github.com/noku-team/original-reviewer/commit/aeec2845efb97aa09e7471bed7334e86deeddb6d))
* verify GitHub webhook signatures ([4611eeb](https://github.com/noku-team/original-reviewer/commit/4611eebd19fe25978dd8e297175209ef835a53d9))
