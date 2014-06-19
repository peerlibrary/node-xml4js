#!/bin/bash

XML4JSON_ARXIV="./convertArxiv.js"
XML4JSON_XML="./convertXml.js"
XML4JSON_OTHER="./convertOther.js"

EXIT_CODE=0

function test() {
    local suite="$1"
    local program="$2"
    local basename="./$suite/$3"
    local output
    echo "Testing $basename.xml to $basename.json"
    output=$(cat "$basename.xml" | $program)
    exit_code=$?
    if [ $exit_code -ne 0 ]; then
        echo "Program failed"
        EXIT_CODE=$exit_code
    else
        echo "$output" > "$basename.json-test"
        if ! diff "$basename.json-test" "$basename.json"; then
            echo "Diff failed"
            EXIT_CODE=1
        fi
        rm -f "$basename.json-test"
    fi
}

for METADATA_PREFIX in oai_dc arXiv arXivOld arXivRaw; do
    for FILE in Identify ListMetadataFormats ListSets "GetRecord-$METADATA_PREFIX" "ListIdentifiers-$METADATA_PREFIX" "ListRecords-$METADATA_PREFIX"; do
        test "arxiv" "$XML4JSON_ARXIV" "$FILE"
    done
done

test "xml" "$XML4JSON_XML" "po"
test "xml" "$XML4JSON_XML" "ipo"
test "xml" "$XML4JSON_XML" "4Q99"

test "other" "$XML4JSON_OTHER" "test1"
test "other" "$XML4JSON_OTHER" "test2"

exit $EXIT_CODE
