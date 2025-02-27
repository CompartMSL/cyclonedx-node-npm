/*!
This file is part of CycloneDX generator for NPM projects.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
Copyright (c) OWASP Foundation. All Rights Reserved.
*/

const { resolve, join } = require('path')
const {
  mkdtempSync, mkdirSync,
  createWriteStream,
  openSync, closeSync, existsSync, writeFileSync, readFileSync
} = require('fs')

const { describe, expect, test } = require('@jest/globals')

const { index: indexNpmLsDemoData } = require('../../_data/npm-ls_demo-results')
const { version: thisVersion } = require('../../../package.json')

const cli = require('../../../dist/cli')

describe('cli.run()', () => {
  const tmpRoot = mkdtempSync(join(__dirname, '..', '..', '_log', 'CDX-IT-CLI.run.'))

  const dummyProjectsRoot = resolve(__dirname, '..', '..', '_data', 'dummy_projects')
  const demoResultsRoot = resolve(__dirname, '..', '..', '_data', 'sbom_demo-results')
  const npmLsReplacementPath = resolve(__dirname, '..', '..', '_data', 'npm-ls_replacement')

  const npmLsReplacement = {
    brokenJson: resolve(npmLsReplacementPath, 'broken-json.js'),
    checkArgs: resolve(npmLsReplacementPath, 'check-args.js'),
    demoResults: resolve(npmLsReplacementPath, 'demo-results.js'),
    justExit: resolve(npmLsReplacementPath, 'just-exit.js'),
    nonExistingBinary: resolve(npmLsReplacementPath, 'aNonExistingBinary')
  }

  describe('broken project', () => {
    const tmpRootRun = join(tmpRoot, 'broken-project')
    mkdirSync(tmpRootRun)

    test.each([
      ['no-lockfile', /missing evidence/i],
      ['no-manifest', /missing .*manifest file/i]
    ])('%s', (folderName, expectedError) => {
      const logFileBase = join(tmpRootRun, folderName)

      const outFile = `${logFileBase}.out`
      const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

      const errFile = `${logFileBase}.err`
      const stderr = createWriteStream(errFile) // not perfect, but works

      const mockProcess = {
        stdout,
        stderr,
        cwd: () => resolve(dummyProjectsRoot, folderName),
        execPath: process.execPath,
        argv0: process.argv0,
        argv: [
          process.argv[0],
          'dummy_process'
        ],
        env: {
          ...process.env,
          // use original npm-ls
          npm_execpath: undefined
        }
      }

      try {
        expect(() => {
          cli.run(mockProcess)
        }).toThrow(expectedError)
      } finally {
        closeSync(stdout.fd)
        stderr.close()
      }
    })
  })

  describe('with broken npm-ls', () => {
    const tmpRootRun = join(tmpRoot, 'with-broken')
    mkdirSync(tmpRootRun)

    test('error on non-existing binary', () => {
      const logFileBase = join(tmpRootRun, 'non-existing')

      const outFile = `${logFileBase}.out`
      const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

      const errFile = `${logFileBase}.err`
      const stderr = createWriteStream(errFile) // not perfect, but works

      const mockProcess = {
        stdout,
        stderr,
        cwd: () => resolve(dummyProjectsRoot, 'with-lockfile'),
        execPath: process.execPath,
        argv0: process.argv0,
        argv: [
          process.argv[0],
          'dummy_process'
        ],
        env: {
          ...process.env,
          npm_execpath: npmLsReplacement.nonExistingBinary
        }
      }

      try {
        expect(() => {
          cli.run(mockProcess)
        }).toThrow(/^unexpected npm execpath/i)
      } finally {
        closeSync(stdout.fd)
        stderr.close()
      }
    })

    test('error on non-zero exit', () => {
      const logFileBase = join(tmpRootRun, 'error-exit-nonzero')

      const expectedExitCode = 1 + Math.floor(254 * Math.random())

      const outFile = `${logFileBase}.out`
      const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

      const errFile = `${logFileBase}.err`
      const stderr = createWriteStream(errFile) // not perfect, but works

      const mockProcess = {
        stdout,
        stderr,
        cwd: () => resolve(dummyProjectsRoot, 'with-lockfile'),
        execPath: process.execPath,
        argv0: process.argv0,
        argv: [
          process.argv[0],
          'dummy_process'
        ],
        env: {
          ...process.env,
          CT_VERSION: '8.99.0',
          // non-zero exit code
          CT_EXIT_CODE: `${expectedExitCode}`,
          npm_execpath: npmLsReplacement.justExit
        }
      }

      try {
        expect(() => {
          cli.run(mockProcess)
        }).toThrow(`npm-ls exited with errors: ${expectedExitCode} noSignal`)
      } finally {
        closeSync(stdout.fd)
        stderr.close()
      }
    })

    test('error on broken json response', () => {
      const logFileBase = join(tmpRootRun, 'error-json-broken')

      const outFile = `${logFileBase}.out`
      const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

      const errFile = `${logFileBase}.err`
      const stderr = createWriteStream(errFile) // not perfect, but works

      const mockProcess = {
        stdout,
        stderr,
        cwd: () => resolve(dummyProjectsRoot, 'with-lockfile'),
        execPath: process.execPath,
        argv0: process.argv0,
        argv: [
          process.argv[0],
          'dummy_process'
        ],
        env: {
          ...process.env,
          CT_VERSION: '8.99.0',
          // abuse the npm-ls replacement, as it can be caused to crash under control.
          npm_execpath: npmLsReplacement.brokenJson
        }
      }

      try {
        expect(() => {
          cli.run(mockProcess)
        }).toThrow(/failed to parse npm-ls response/i)
      } finally {
        closeSync(stdout.fd)
        stderr.close()
      }
    })
  })

  describe('with prepared npm-ls', () => {
    const tmpRootRun = join(tmpRoot, 'with-prepared')
    mkdirSync(tmpRootRun)

    const useCases = [
      { subject: 'bare', args: [] },
      { subject: 'flatten-components', args: ['--flatten-components'] }
    ]
    const demoCases = indexNpmLsDemoData()
    describe.each(useCases)('$subject', (ud) => {
      mkdirSync(join(tmpRootRun, ud.subject))

      test.each(demoCases)('$subject npm$npm node$node $os', (dd) => {
        const expectedOutSnap = resolve(demoResultsRoot, ud.subject, `${dd.subject}_npm${dd.npm}_node${dd.node}_${dd.os}.snap.json`)
        const logFileBase = join(tmpRootRun, ud.subject, `${dd.subject}_npm${dd.npm}_node${dd.node}_${dd.os}`)

        const outFile = `${logFileBase}.out`
        const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

        const errFile = `${logFileBase}.err`
        const stderr = createWriteStream(errFile) // not perfect, but works

        const mockProcess = {
          stdout,
          stderr,
          cwd: () => resolve(__dirname, '..', '..', '_data', 'dummy_projects'),
          execPath: process.execPath,
          argv0: process.argv0,
          argv: [
            process.argv[0],
            'dummy_process',
            '--output-reproducible',
            // no intention to test all the spec-versions nor all the output-formats - this would be not our scope.
            // just use json with the latest most feature-rich version.
            '--spec-version', '1.4',
            '--output-format', 'JSON',
            // prevent file interaction in this synthetic scenario - they would not exist anyway
            '--package-lock-only',
            // case-specific args
            ...ud.args,
            '--',
            // just some dummy project
            join('with-lockfile', 'package.json')
          ],
          env: {
            ...process.env,
            CT_VERSION: `${dd.npm}.99.0`,
            CT_SUBJECT: dd.subject,
            CT_NPM: dd.npm,
            CT_NODE: dd.node,
            CT_OS: dd.os,
            npm_execpath: npmLsReplacement.demoResults
          }
        }

        try {
          cli.run(mockProcess)
        } finally {
          closeSync(stdout.fd)
          stderr.close()
        }

        const actualOutput = makeReproducible('json', readFileSync(outFile, 'utf8'))

        if (!existsSync(expectedOutSnap)) {
          writeFileSync(expectedOutSnap, actualOutput, 'utf8')
        }

        expect(actualOutput).toEqual(
          readFileSync(expectedOutSnap, 'utf8'),
          `${outFile} should equal ${expectedOutSnap}`
        )
      })
    })
  })

  test('suppressed error on non-zero exit', () => {
    const dd = { subject: 'dev-dependencies', npm: '8', node: '16', os: 'ubuntu-latest' }

    mkdirSync(join(tmpRoot, 'suppressed-error-on-non-zero-exit'))
    const expectedOutSnap = resolve(demoResultsRoot, 'suppressed-error-on-non-zero-exit', `${dd.subject}_npm${dd.npm}_node${dd.node}_${dd.os}.snap.json`)
    const logFileBase = join(tmpRoot, 'suppressed-error-on-non-zero-exit', `${dd.subject}_npm${dd.npm}_node${dd.node}_${dd.os}`)

    const expectedExitCode = 1 + Math.floor(254 * Math.random())

    const outFile = `${logFileBase}.out`
    const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

    const errFile = `${logFileBase}.err`
    const stderr = createWriteStream(errFile) // not perfect, but works

    const mockProcess = {
      stdout,
      stderr,
      cwd: () => resolve(__dirname, '..', '..', '_data', 'dummy_projects'),
      execPath: process.execPath,
      argv0: process.argv0,
      argv: [
        process.argv[0],
        'dummy_process',
        '--ignore-npm-errors',
        // no intention to test all the spec-versions nor all the output-formats - this would be not our scope.
        '--output-reproducible',
        '--spec-version', '1.4',
        '--output-format', 'JSON',
        // prevent file interaction in this synthetic scenario - they would not exist anyway
        '--package-lock-only',
        '--',
        join('with-lockfile', 'package.json')
      ],
      env: {
        ...process.env,
        CT_VERSION: `${dd.npm}.99.0`,
        // non-zero exit code
        CT_EXIT_CODE: expectedExitCode,
        CT_SUBJECT: dd.subject,
        CT_NPM: dd.npm,
        CT_NODE: dd.node,
        CT_OS: dd.os,
        npm_execpath: npmLsReplacement.demoResults
      }
    }

    try {
      cli.run(mockProcess)
    } finally {
      closeSync(stdout.fd)
      stderr.close()
    }

    const actualOutput = makeReproducible('json', readFileSync(outFile, 'utf8'))

    if (!existsSync(expectedOutSnap)) {
      writeFileSync(expectedOutSnap, actualOutput, 'utf8')
    }

    expect(actualOutput).toEqual(
      readFileSync(expectedOutSnap, 'utf8'),
      `${outFile} should equal ${expectedOutSnap}`
    )
  })

  describe('npm-version depending npm-args', () => {
    const tmpRootRun = join(tmpRoot, 'npmVersion-depending-npmArgs')
    mkdirSync(tmpRootRun)

    const rMinor = Math.round(99 * Math.random())
    const rPatch = Math.round(99 * Math.random())
    const le6 = Math.round(6 * Math.random())
    const ge7 = 7 + Math.round(92 * Math.random())

    const npmArgsGeneral = ['--json', '--long']
    const npm6ArgsGeneral = [...npmArgsGeneral, '--depth=255']
    const npm7ArgsGeneral = [...npmArgsGeneral, '--all']
    const npm8ArgsGeneral = [...npmArgsGeneral, '--all']

    test.each([
      ['basic npm 6', `6.${rMinor}.${rPatch}`, [], npm6ArgsGeneral],
      ['basic npm 7', `7.${rMinor}.${rPatch}`, [], npm7ArgsGeneral],
      ['basic npm 8', `8.${rMinor}.${rPatch}`, [], npm8ArgsGeneral],
      // region omit
      ['omit everything npm 6', `6.${rMinor}.${rPatch}`, ['--omit', 'dev', 'optional', 'peer'], [...npm6ArgsGeneral, '--production']],
      ['omit everything npm 7', `7.${rMinor}.${rPatch}`, ['--omit', 'dev', 'optional', 'peer'], [...npm7ArgsGeneral, '--production']],
      ['omit everything npm lower 8.7', `8.${le6}.${rPatch}`, ['--omit', 'dev', 'optional', 'peer'], [...npm8ArgsGeneral, '--production']],
      ['omit everything npm greater-equal 8.7 ', `8.${ge7}.${rPatch}`, ['--omit', 'dev', 'optional', 'peer'], [...npm8ArgsGeneral, '--omit=dev', '--omit=optional', '--omit=peer']],
      // endregion
      // region package-lock-only
      ['package-lock-only not supported npm 6 ', `6.${rMinor}.${rPatch}`, ['--package-lock-only'], [...npm6ArgsGeneral]],
      ['package-lock-only npm 7', `7.${rMinor}.${rPatch}`, ['--package-lock-only'], [...npm7ArgsGeneral, '--package-lock-only']],
      ['package-lock-only npm 8', `8.${rMinor}.${rPatch}`, ['--package-lock-only'], [...npm8ArgsGeneral, '--package-lock-only']]
      // endregion
    ])('%s', (purpose, npmVersion, cdxArgs, expectedArgs) => {
      const logFileBase = join(tmpRootRun, purpose.replace(/\W/g, '_'))

      const outFile = `${logFileBase}.out`
      const stdout = { fd: openSync(outFile, 'w') } // not perfect, but works

      const errFile = `${logFileBase}.err`
      const stderr = createWriteStream(errFile) // not perfect, but works

      const mockProcess = {
        stdout,
        stderr,
        cwd: () => resolve(__dirname, '..', '..', '_data', 'dummy_projects'),
        execPath: process.execPath,
        argv0: process.argv0,
        argv: [
          process.argv[0],
          'dummy_process',
          ...cdxArgs,
          '--',
          join('with-lockfile', 'package.json')
        ],
        env: {
          ...process.env,
          CT_VERSION: npmVersion,
          CT_EXPECTED_ARGS: expectedArgs.join(' '),
          npm_execpath: npmLsReplacement.checkArgs
        }
      }

      try {
        cli.run(mockProcess)
      } finally {
        closeSync(stdout.fd)
        stderr.close()
      }
    })
  })
})

/**
 * @param {string} format
 * @param {*} data
 * @returns {string}
 */
function makeReproducible (format, data) {
  switch (format.toLowerCase()) {
    case 'xml':
      return makeXmlReproducible(data)
    case 'json':
      return makeJsonReproducible(data)
    default:
      throw new RangeError(`unexpected format: ${format}`)
  }
}

/**
 * @param {string} json
 * @returns {string}
 */
function makeJsonReproducible (json) {
  return json
    .replace(
      // replace metadata.tools.version
      '        "vendor": "@cyclonedx",\n' +
      '        "name": "cyclonedx-npm",\n' +
      `        "version": ${JSON.stringify(thisVersion)},\n`,
      '        "vendor": "@cyclonedx",\n' +
      '        "name": "cyclonedx-npm",\n' +
      '        "version": "thisVersion-testing",\n'
    ).replace(
      // replace metadata.tools.version
      new RegExp(
        '        "vendor": "@cyclonedx",\n' +
        '        "name": "cyclonedx-library",\n' +
        '        "version": ".+?",\n'
      ),
      '        "vendor": "@cyclonedx",\n' +
      '        "name": "cyclonedx-library",\n' +
      '        "version": "libVersion-testing",\n'
    )
}

/**
 * @param {string} xml
 * @returns {string}
 *
 * eslint-disable-next-line no-unused-vars
 */
function makeXmlReproducible (xml) {
  return xml
    .replace(
      // replace metadata.tools.version
      '        <vendor>@cyclonedx</vendor>\n' +
      '        <name>cyclonedx-npm</name>\n' +
      `        <version>${thisVersion}</version>`,
      '        <vendor>@cyclonedx</vendor>\n' +
      '        <name>cyclonedx-npm</name>\n' +
      '        <version>thisVersion-testing</version>'
    ).replace(
      // replace metadata.tools.version
      new RegExp(
        '        <vendor>@cyclonedx</vendor>\n' +
        '        <name>cyclonedx-library</name>\n' +
        '        <version>.+?</version>'
      ),
      '        <vendor>@cyclonedx</vendor>\n' +
      '        <name>cyclonedx-library</name>\n' +
      '        <version>libVersion-testing</version>'
    )
}
