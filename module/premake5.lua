workspace "gmsv_blocksocket"
    configurations { "Debug", "Release" }
    location ( "projects/" .. os.get() )

project "gmsv_blocksocket"
    kind         "SharedLib"
    architecture "x86"
    language     "C++"
    includedirs  "../include/"
    targetdir    "build"
    
    if os.is( "windows" ) then targetsuffix "_win32" end
    if os.is( "macosx" )  then targetsuffix "_osx"   end
    if os.is( "linux" )   then targetsuffix "_linux" end

    configuration "Debug"
        optimize "Debug"

    configuration "Release"
        optimize "Speed"
        flags    "StaticRuntime"

    files
    {
        "src/**.*",
        "../include/**.*"
    }
