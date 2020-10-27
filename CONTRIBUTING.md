# Filing Issues
A good issue can mean the difference between a quick fix and a long, painful fixing process. That's why the
following guidelines exist:

 - Use the [Github issue tracker](https://github.com/matrix-org/matrix-bifrost/issues) to file your issues.
 - Write a short title which neatly summaries the *problem*. Do **not** write the *solution* in the issue title.
   For example: `Cannot create a nick with | in it` is a good issue title. `Filter nicks according to RFC 2812`
   is not a good issue title.
 - Give a summary and as much information (along with proposed solutions) as possible in the body of the issue.
 - Include reproduction steps where possible.
 - Provide the commit SHA or version number of the Bifrost bridge being used.
 - Provide the kind and version of the XMPP server (e.g. `Prosody 0.11.7`).

# Making Pull Requests
This project follows "git flow" semantics. In practice, this means:
 - The `master` branch is latest current stable release.
 - The `develop` branch is where all the new code ends up.
 - When forking the project, fork from `develop` and then write your code.
 - Make sure your new code passes all the code checks (tests and linting). Do this by running
   `npm run test && npm run lint`.
 - Create a pull request. If this PR fixes an issue, link to it by referring to its number.
 - PRs from community members must be signed off as per Synapse's [Sign off section](https://github.com/matrix-org/synapse/blob/master/CONTRIBUTING.md#sign-off)
 - Create a changelog entry in `changelog.d`. A changelog filename should be `${GithubPRNumber}.{bugfix|misc|feature|doc|removal}`
   The change should include information that is useful to the user rather than the developer.
   You can choose to sign your changelog entry to be credited by appending something like "Thanks to @Half-Shot"
   at the end of the file, on the same line.

## Coding notes
The Bifrost bridge is compatible on Node.js v10+. Buildkite is used to ensure that tests will run on
supported environments. Code should not use any ES features greater than that supported in ES2019.
Please see http://node.green/ for a list of supported features.
 
Tests are written in Mocha. Depending on the pull request, you may be asked to write tests for
new code.

## Release notes
 - Changes are put in `CHANGELOG.md`.
 - Each formal release corresponds to a branch which is of the form `vX.Y.Z` where `X.Y.Z` maps
   directly onto the `package.json` (NPM) version.
 - Releases are also tagged so they are present on the Releases page on Github.
 - Releases should be signed by the maintainer's key.
