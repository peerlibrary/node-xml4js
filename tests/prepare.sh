#!/bin/bash -e

XML4JSON_ARXIV="./convertArxiv.js"
XML4JSON_XML="./convertXml.js"
XML4JSON_OTHER="./convertOther.js"

function download() {
    local url="$1"
    local filename="./arxiv/$2"
    if [ ! -e "$filename" ]; then
        wget "--output-document=$filename" "$url"
        sleep 20
    fi
}

function convertArxiv() {
    local basename="./arxiv/$1"
    local output
    if [ ! -e "$basename.json" ]; then
        echo "Converting $basename.xml to $basename.json"
        output=$(cat "$basename.xml" | $XML4JSON_ARXIV)
        echo "$output" > "$basename.json"
    fi
}

function convertXml() {
    local basename="./xml/$1"
    local output
    if [ ! -e "$basename.json" ]; then
        echo "Converting $basename.xml to $basename.json"
        output=$(cat "$basename.xml" | $XML4JSON_XML)
        echo "$output" > "$basename.json"
    fi
}

function convertOther() {
    local basename="./other/$1"
    local output
    if [ ! -e "$basename.json" ]; then
        echo "Converting $basename.xml to $basename.json"
        output=$(cat "$basename.xml" | $XML4JSON_OTHER)
        echo "$output" > "$basename.json"
    fi
}

download "http://export.arxiv.org/oai2?verb=Identify" "Identify.xml"
download "http://export.arxiv.org/oai2?verb=ListMetadataFormats" "ListMetadataFormats.xml"
download "http://export.arxiv.org/oai2?verb=ListSets" "ListSets.xml"

for METADATA_PREFIX in oai_dc arXiv arXivOld arXivRaw; do
    download "http://export.arxiv.org/oai2?verb=GetRecord&identifier=oai:arXiv.org:0804.2273&metadataPrefix=$METADATA_PREFIX" "GetRecord-$METADATA_PREFIX.xml"
    download "http://export.arxiv.org/oai2?verb=ListIdentifiers&metadataPrefix=$METADATA_PREFIX" "ListIdentifiers-$METADATA_PREFIX.xml"
    download "http://export.arxiv.org/oai2?verb=ListRecords&metadataPrefix=$METADATA_PREFIX" "ListRecords-$METADATA_PREFIX.xml"
done

download "http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd" "OAI-PMH.xsd"
download "http://www.openarchives.org/OAI/1.1/eprints.xsd" "eprints.xsd"
download "http://www.openarchives.org/OAI/2.0/branding.xsd" "branding.xsd"
download "http://www.openarchives.org/OAI/2.0/oai_dc.xsd" "oai_dc.xsd"
download "http://dublincore.org/schemas/xmls/simpledc20021212.xsd" "simpledc20021212.xsd"
download "http://www.w3.org/2001/03/xml.xsd" "xml.xsd"
download "http://arxiv.org/OAI/arXiv.xsd" "arXiv.xsd"
download "http://arxiv.org/OAI/arXivOld.xsd" "arXivOld.xsd"
download "http://arxiv.org/OAI/arXivRaw.xsd" "arXivRaw.xsd"

if ! grep --quiet "acm-class" "./arxiv/arXiv.xsd"; then
    patch --directory=./arxiv < "arXiv.xsd.patch"
fi

if grep --quiet "http://arXiv.org/OAI/arXivOld/" "./arxiv/arXivOld.xsd"; then
    patch --directory=./arxiv < "arXivOld.xsd.patch1"
fi

if ! grep --quiet "categories" "./arxiv/arXivOld.xsd"; then
    patch --directory=./arxiv < "arXivOld.xsd.patch2"
fi

if ! grep --quiet "proxy" "./arxiv/arXivRaw.xsd"; then
    patch --directory=./arxiv < "arXivRaw.xsd.patch"
fi

for METADATA_PREFIX in oai_dc arXiv arXivOld arXivRaw; do
    for FILE in Identify ListMetadataFormats ListSets "GetRecord-$METADATA_PREFIX" "ListIdentifiers-$METADATA_PREFIX" "ListRecords-$METADATA_PREFIX"; do
        convertArxiv "$FILE"
    done
done

convertXml "po"
convertXml "ipo"
convertXml "4Q99"

convertOther "test"
