import { Enums, Models } from '@cyclonedx/cyclonedx-library'
import * as fs from 'fs'
import * as minimatch from 'minimatch'
import * as path from 'path'

// export interface LicenseBuilder {}

export class LicenseBuilder {
  static typicalFilenames (): string[] {
    return ['license', 'licence', 'notice', 'unlicense', 'unlicence']
  }

  static licenseContentTypes (): Record<string, any> {
    return { '': 'text/plain', '.txt': 'text/txt', '.md': 'text/markdown', '.xml': 'text/xml' }
  }

  static fileExtensions (): string[] {
    return Object.keys(LicenseBuilder.licenseContentTypes())
  }

  static contentTypes (): string[] {
    return Object.values(LicenseBuilder.licenseContentTypes())
  }

  static guessContentType (ext: string): string {
    return (LicenseBuilder.licenseContentTypes()[ext])
  }

  searchLicenseSources (pkgPath: string, licenseName: string): string[] {
    const licenseFilenames: string[] = []
    if (pkgPath.length < 1) {
      return licenseFilenames
    }
    const shortLicName = licenseName.replace(/-.*/, '')
    const availableFilenames = fs.readdirSync(pkgPath)
    for (const typicalFilename of LicenseBuilder.typicalFilenames()) {
      for (const filenameVariant of [typicalFilename, typicalFilename + '.' + shortLicName, shortLicName + '.' + typicalFilename, typicalFilename + '-' + shortLicName]) {
        for (const fileExtension of LicenseBuilder.fileExtensions()) {
          for (const filename of minimatch.match(availableFilenames, filenameVariant + fileExtension, { nocase: true, noglobstar: true, noext: true })) {
            licenseFilenames.push(path.join(pkgPath, filename))
          }
        }
      }
    }
    return licenseFilenames
  }

  addText (license: Models.DisjunctiveLicense, filenames: string[]): void {
    if (filenames.length > 0) {
      const filename = filenames[0]
      const licContent = fs.readFileSync(filename, { encoding: 'base64' })
      license.text = new Models.Attachment(licContent, {
        encoding: Enums.AttachmentEncoding.Base64,
        contentType: LicenseBuilder.guessContentType(path.extname(filename))
      })
    }
  }

  addTexts (licenses: Models.LicenseRepository, pkgPath: string): number {
    let licAdded = 0
    for (const license of licenses) {
      if (license instanceof Models.NamedLicense) {
        this.addText(license, this.searchLicenseSources(pkgPath, license.name))
      } else if (license instanceof Models.SpdxLicense) {
        this.addText(license, this.searchLicenseSources(pkgPath, license.id))
      } else {
      }
      if (!(license instanceof Models.LicenseExpression) && license.text != undefined) {
        licAdded ++
      }
    }
    return licAdded
  }

}
