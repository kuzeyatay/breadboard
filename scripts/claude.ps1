# Breadboard Claude account launcher. The official claude.exe stays beside this script.
$entry = Join-Path $PSScriptRoot 'breadboard-claude\claude-accounts-cli.mjs'
if ($MyInvocation.ExpectingInput) {
    $input | & node.exe $entry @args
} else {
    & node.exe $entry @args
}
exit $LASTEXITCODE
