#!/bin/bash
#
# usage: ./lsone [href]
#
# If href parameter is specified, only the href hashes are colored. Otherwise all hases will be colored purple
for pattern in "data/*/objects/*" "data/*/reverse-maps/*" "data/*/version-maps/*" "data/*/private/*" "data/*/tmp/*"
do
    printf "\033[1;32m$pattern\033[0m\n" \;
    for file in $(find data -path "$pattern" -type f)
    do
        printf "\033[91m$(basename -- $file)\033[0m\n" \;
        if [ "$1" = "short" ]; then
            continue;
        fi;

        # Execute tidy
        output=$(tidy -xml -i -w 0 $file 2> /dev/null)

        # If tidy failed, then assign file content as output
        if [ $? -ne 0 ]; then
            output=$(cat $file)
        fi

        # Format output
        if [ "$1" = "href" ]; then
            output=$(sed 's/href=\"\([^\"]*\)\"/href=\"\\033[35m\1\\033[0m\"/g' <<< "$output")
        else
            output=$(sed 's/\([0-9a-f]\{64\}\)/\\033[35m\1\\033[0m/g' <<< "$output")
        fi
        output=$(sed 's/\(http:\/\/[^\"]*\)/\\033[36m\1\\033[0m/g' <<< "$output")

        # Print output
        printf "$output"
        echo ""
    done
    echo ""
done
