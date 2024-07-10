import core from '@actions/core'
import {Octokit} from '@octokit/rest'
import {retry} from '@octokit/plugin-retry'
import {throttling} from '@octokit/plugin-throttling'

const appID = core.getInput('APP_ID', {required: true, trimWhitespace: true}).trim()
const issueNumber = core.getInput('ISSUE_NUMBER', {required: true, trimWhitespace: true}).trim()
const org = core.getInput('ORG', {required: true, trimWhitespace: true}).trim()
const repo = core.getInput('REPO', {required: true, trimWhitespace: true}).trim()
const target = core.getInput('TARGET_REPO', {required: true, trimWhitespace: true}).trim()
const token = core.getInput('TOKEN', {required: true, trimWhitespace: true}).trim()

const _Octokit = Octokit.plugin(retry, throttling)
const client = new _Octokit({
    auth: token,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`)
            if (options.request.retryCount === 0) {
                octokit.log.info(`Retrying after ${retryAfter} seconds!`)
                return true
            }
        },
        onSecondaryRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`)
        },
    }

})

async function main() {
    try {
        core.info(`Retrieving issue ${issueNumber} from ${org}/${repo}`)
        const {data: issue} = await client.issues.get({
            owner: org,
            repo: repo,
            issue_number: issueNumber
        })
        const author = issue.user.login
        core.info(`Checking if ${author} is a collaborator on ${org}/${target}`)
        const {data: permissions} = await client.repos.checkCollaborator({
            owner: org,
            repo: target,
            username: author
        })
        if (permissions.permissions === 'admin' || permissions.permissions === 'write') {
            return core.setFailed(`${author} does not have write or admin permissions on ${org}/${target}`)
        }
        core.info(`${author} is a collaborator on ${org}/${target}`)
        core.info(`Retrieving repository ID for ${org}/${target}`)
        const {data: repository} = await client.repos.get({
            owner: org,
            repo: target
        })
        core.info(`Installing app ${appID} on ${org}/${target} with repository ID ${repository.id}`)
        await client.request('PUT /user/installations/{installation_id}/repositories/{repository_id}', {
            installation_id: appID,
            repository_id: repository.id
        })
    } catch (e){
        core.error(`Failed to install app ${appID} on ${org}/${target}`)
        await client.issues.createComment({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            body: `Failed to install app ${appID} on ${org}/${target} with error: ${e.message}`
        })
        return core.setFailed(e.message)
    }

    try {
        core.info(`Installed app ${appID} on ${org}/${target}`)
        await client.issues.createComment({
            owner: org,
            repo: repo,
            issue_number: issueNumber,
            body: `Successfully installed app ${appID} on ${org}/${target}`
        })
    } catch (e) {
        return core.setFailed(`Failed to comment on issue ${issueNumber}`)
    }
}

main()
