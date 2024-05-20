import axios from 'axios'
import YAML from 'yaml'
import fs from 'fs'
import path from 'path'

interface RemotePlugin {
    id: string // internal id of plugin
    name: string // display name of plugin
    metadata?: Record<string, string> | { description?: string } // metadata of plugin
    version: string // version of plugin appended with hash
    dath: string // date of last update
    path: string // path to zip file relative to yml
    sha256: string // sha256 hash of zip file
    requires: string[] // list of dependencies
}

type RemoteIndex = RemotePlugin[]

interface LocalRepository {
    collection: LocalCollection
    scripts: LocalSidecar[]
}

interface LocalCollection {
    index: string // index url of collection
    global_repo: string // repository of collection
    global_author?: string // author of collection if it is just owner
    base_path?: string // base path to plugins
}

interface LocalSidecar {
    id: string // internal id of plugin
    path?: string // override path to plugin if not id
    description?: string // override description if not in index
    readme?: string // path to readme file
    author?: string // author of plugin
    screenshots?: string[] // screenshots of plugin
}

// iterate over folder
async function searchRepository() {
    const repoPath = path.resolve('./repositories')
    const repoFiles = fs.readdirSync(repoPath)

    const repositories: LocalRepository[] = []
    // find all files
    repoFiles.forEach(file => {
        if (file.endsWith(".yml")) {
            const fileData = fs.readFileSync(`${repoPath}/${file}`, 'utf8')
            const localRepo: LocalRepository = YAML.parse(fileData)
            repositories.push(localRepo)
        }
    })
    // iterate over repositories
    const plugins: Plugin[] = []
    for (const repo of repositories) {
        const plugin = await parseRepository(repo)
        plugins.push(...plugin)
    }
    // sort plugins and print to md
    const sortedPlugins = plugins
        .sort((a, b) => a.name.localeCompare(b.name))
    // print to file
    const outputPath = "./generated.md"
    const stream = fs.createWriteStream(outputPath)
    stream.write("# Plugins list\n\n")
    // iterate over plugins
    for (const plugin of sortedPlugins) {
        stream.write(plugin.printMD())
        stream.write("\n")
    }
    stream.end()
}

async function parseRepository(localRepository: LocalRepository): Promise<Plugin[]> {
    // load from parsed
    const repoDefaults: LocalCollection = localRepository.collection
    const repoSidecars: LocalSidecar[] = localRepository.scripts
    // grab from index.yml
    const indexData: RemoteIndex = await axios.get(repoDefaults.index)
        .then(res => YAML.parse(res.data))
    // iterate over remote index and match with sidecars
    const indexPlugins: Plugin[] = []
    for (const index of indexData) {
        const sidecarMatch = repoSidecars.find(sidecar => sidecar.id === index.name)
        const plugin = new Plugin(repoDefaults, sidecarMatch, index)
        indexPlugins.push(plugin)
    }
    return indexPlugins
}

searchRepository()

class Plugin {
    id: string // internal id of plugin
    name: string // display name of plugin
    description: string // description of plugin if available
    index: string // index url of collection
    repo: string // repository of collection
    author: string // author of plugin
    path: string // path to plugin in repository
    screenshots: string[] // screenshots of plugin
    readme: string | boolean | undefined // readme file
    base_path: string // path to plugins/ folder
    repo_path: string // path to repository in the format of owner/repo

    constructor(defaults: LocalCollection, sidecar: LocalSidecar | undefined, index: RemotePlugin) {
        this.id = index.id
        this.name = index.name 
        this.description = index?.metadata?.description
            ?? sidecar?.description
            ?? "No Description Provided"
        this.index = defaults.index
        this.repo = defaults.global_repo
        this.author = sidecar?.author
            ?? defaults?.global_author // fall back to global author
            ?? "No Author" // if no author
        this.path = sidecar?.path
            ?? index.id // default to ID
        this.screenshots = sidecar?.screenshots ?? []
        this.readme = sidecar?.readme ?? true // readme file
        this.base_path = defaults.base_path ?? "main/plugins"
        this.repo_path = `${this.base_path}/${this.path}`
    }

    printMD() {
        // pre prepared values
        const folderPath = `https://github.com/${this.repo}/tree/${this.repo_path}`
        const filePath = `https://github.com/${this.repo}/blob/${this.repo_path}`
        // if false, no readme
        // if true, default readme
        // otherwise, follow path or url
        const readme = typeof(this.readme) == "string" // if readme is string
            ? this.readme.includes("http") // if link, add target blank
                ? `[README](${this.readme}){target=_blank}`
                : `[README](${filePath}/${this.readme}){target=_blank}`
            : this.readme // readme is boolean
                ? `[README](${filePath}/README.md){target=_blank}` // default path
                : "No README"
        const screenshots = this.screenshots
            .map(screenshot => `![${this.name} screenshot](${screenshot})  `)
            .join("\n")
        // ugly formatted markdown
        return `
### [${this.name}](${folderPath}){target=_blank}

=== "Description"

    ${this.description}

=== "Source URL"

    \`\`\`
    ${this.index}
    \`\`\`

=== "README"

    ${readme}

=== "Author"

    ${this.author.replace(/(\[.+\](http.+)\s|,)/g, '$1{target=_blank}')}

=== "Screenshots"
    ${screenshots}`
    }
}
